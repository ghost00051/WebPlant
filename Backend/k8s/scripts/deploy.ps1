#Requires -Version 5.1
<#
.SYNOPSIS
    Развёртывание WebPlant (backend + PostgreSQL + Redis) в Kubernetes.

.DESCRIPTION
    Собирает образ backend, доставляет его на ноды кластера, создаёт объекты
    в namespace webplant и (при необходимости) переносит боевые данные из
    работающего docker-compose стека: дамп PostgreSQL и каталог uploads.

    Compose-стек при этом не изменяется: из него только читаются данные
    (pg_dump + tar uploads), контейнеры не перезапускаются.

.PARAMETER Tag
    Тег образа. По умолчанию — версия из package.json и короткий хеш git.

.PARAMETER SkipBuild
    Не пересобирать образ (использовать уже собранный с этим тегом).

.PARAMETER SkipImageLoad
    Не доставлять образ на ноды (например, если он там уже есть).

.PARAMETER RestoreData
    Принудительно перенести дамп БД и uploads из compose-стека. Без флага
    перенос выполняется автоматически, если база в кластере ещё пустая.

.PARAMETER EnableBackgroundJobs
    Включить фоновые задачи (напоминания, рассылки, очистка) в кластере.

.PARAMETER DisableBackgroundJobs
    Выключить фоновые задачи в кластере (например, если они временно
    выполняются compose-стеком).

    Без обоих флагов сохраняется текущее значение из кластера, поэтому обычное
    обновление кода не меняет режим фоновых задач. На новом кластере они
    выключаются по умолчанию, чтобы не дублировать push-уведомления.

.PARAMETER Replicas
    Количество реплик backend (по умолчанию 2).

.PARAMETER SkipGateway
    Не поднимать gateway-контейнер ctp_k8s_gateway (внешний доступ на localhost:8090).

.EXAMPLE
    powershell -File Backend/k8s/scripts/deploy.ps1 -RestoreData
#>
[CmdletBinding()]
param(
    [string]$Tag,
    [switch]$SkipBuild,
    [switch]$SkipImageLoad,
    [switch]$RestoreData,
    [switch]$EnableBackgroundJobs,
    [switch]$DisableBackgroundJobs,
    [int]$Replicas = 2,
    [switch]$SkipGateway
)

$ErrorActionPreference = 'Stop'

$K8sDir = Split-Path -Parent $PSScriptRoot
$BackendDir = Split-Path -Parent $K8sDir
$RepoRoot = Split-Path -Parent $BackendDir
$StagingDir = Join-Path $RepoRoot '.k8s-images'
$Namespace = 'webplant'
$ImageServerName = 'ctp_k8s_img_server'
$ImageServerPort = 8099
$GatewayName = 'ctp_k8s_gateway'
$GatewayPort = 8090
$ComposeProjectNetwork = 'backend_ctp_network'
$NodePort = 30080

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host "  OK  $Text" -ForegroundColor Green
}

function Write-WarnStep([string]$Text) {
    Write-Host "  !!  $Text" -ForegroundColor Yellow
}

function Write-Lines($Lines) {
    foreach ($line in @($Lines)) { Write-Host $line }
}

# Запускает нативную команду (docker/kubectl) не давая stderr прервать скрипт:
# в Windows PowerShell 5.1 запись в stderr при $ErrorActionPreference = 'Stop'
# превращается в прерывающую ошибку, поэтому внутри хелпера режим временно мягкий.
function Invoke-Native {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [switch]$Capture
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @()
    try {
        if ($Capture) {
            $output = @(& $Action 2>&1)
        } else {
            & $Action 2>&1 | Out-Null
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }

    return [pscustomobject]@{
        ExitCode = [int]$code
        Output   = $output
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$What,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    $result = Invoke-Native -Action $Action -Capture
    if ($result.ExitCode -ne 0) {
        Write-Lines $result.Output
        throw "$What (код $($result.ExitCode))"
    }
    return $result.Output
}

function Get-NativeLines {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [switch]$AllowFailure
    )

    $result = Invoke-Native -Action $Action -Capture
    if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
        throw "Команда завершилась с кодом $($result.ExitCode): $(($result.Output | Out-String).Trim())"
    }
    return @($result.Output | Out-String -Stream | Where-Object { $_.Trim() })
}

function Get-NativeText {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [switch]$AllowFailure
    )
    return ((Get-NativeLines -Action $Action -AllowFailure:$AllowFailure) -join "`n").Trim()
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Read-Utf8([string]$Path) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    return [System.IO.File]::ReadAllText($Path, $encoding)
}

function Read-DotEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Не найден $Path — создайте его по образцу рабочего окружения"
    }

    $map = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }

        $index = $trimmed.IndexOf('=')
        if ($index -lt 1) { continue }

        $key = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $map[$key] = $value
    }
    return $map
}

function New-RandomPassword {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $chars = 1..40 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] }
    return (-join $chars)
}

function ConvertFrom-Base64([string]$Value) {
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function Test-DockerContainer([string]$Name) {
    $found = Get-NativeLines -AllowFailure { docker ps -a --filter "name=$Name" --format '{{.Names}}' }
    return [bool]($found | Where-Object { $_ -eq $Name })
}

# --- 1. Проверки окружения ---------------------------------------------------

Write-Step 'Проверяю окружение'

$context = Get-NativeText { kubectl config current-context }
if ($context -notmatch 'docker-desktop') {
    throw "kubectl смотрит в контекст '$context'. Ожидается docker-desktop (Kubernetes Docker Desktop)."
}
Write-Ok "kubectl контекст: $context"

$envMap = Read-DotEnv (Join-Path $BackendDir '.env')
$dbName = $envMap['DB_NAME']
$dbUser = $envMap['DB_USER']
foreach ($required in @('DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SECRET_KEY', 'FRONTEND_URL', 'FRONTEND_ORIGIN', 'RP_ID', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT')) {
    if (-not $envMap[$required]) { throw "В Backend/.env не задано $required" }
}
Write-Ok "Backend/.env прочитан (БД: $dbName, пользователь: $dbUser)"

if (-not (Test-Path -LiteralPath $StagingDir)) {
    New-Item -ItemType Directory -Path $StagingDir | Out-Null
}

if (-not $Tag) {
    $packageVersion = (Read-Utf8 (Join-Path $BackendDir 'package.json') | ConvertFrom-Json).version
    $gitHash = Get-NativeText -AllowFailure { git -C $RepoRoot rev-parse --short HEAD }
    if ($gitHash -match '^[0-9a-f]{4,}$') {
        $Tag = "$packageVersion-$gitHash"
    } else {
        $Tag = "$packageVersion-$(Get-Date -Format 'yyyyMMddHHmmss')"
    }

    # Незакоммиченные правки в Backend/ обязаны менять тег: иначе image-loader
    # сочтёт образ уже доставленным и на нодах останется старый код.
    $dirty = Get-NativeText -AllowFailure { git -C $RepoRoot status --porcelain -- Backend }
    if ($dirty) {
        $diff = Get-NativeText -AllowFailure { git -C $RepoRoot diff HEAD -- Backend }
        $md5 = [System.Security.Cryptography.MD5]::Create()
        try {
            $hashBytes = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$dirty$diff"))
        } finally {
            $md5.Dispose()
        }
        $dirtyHash = ([System.BitConverter]::ToString($hashBytes) -replace '-', '').Substring(0, 8).ToLower()
        $Tag = "$Tag-dirty-$dirtyHash"
        Write-WarnStep 'В Backend/ есть незакоммиченные изменения — к тегу добавлен -dirty-хэш'
    }
}
$image = "webplant-backend:$Tag"
Write-Ok "Тег образа: $Tag"

# --- 2. Ключи окружения: ConfigMap и Secret ---------------------------------

Write-Step 'Обновляю webplant-env и webplant-secrets'

# Эти ключи задаёт сам кластер (10-configmap.yaml и секрет), из .env они не переносятся
$overriddenKeys = @(
    'DB_HOST', 'DB_PORT', 'NODE_ENV', 'PORT', 'SERVER_PORT', 'DOMAIN',
    'DOCKER_HOST', 'DOCKER_STATS_ENABLED', 'BACKGROUND_JOBS_ENABLED', 'DEPLOY_TARGET',
    'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_KEY_PREFIX',
    'AI_CACHE_ENABLED', 'AI_CACHE_TTL_SECONDS', 'AI_CHAT_CACHE_TTL_SECONDS'
)
$secretKeys = @('DB_PASSWORD', 'SECRET_KEY', 'YANDEX_CLOUD_API_KEY', 'VAPID_PRIVATE_KEY')

$namespaceCreated = Invoke-Native -Action { kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f - } -Capture
if ($namespaceCreated.ExitCode -ne 0) {
    Write-Lines $namespaceCreated.Output
    throw 'Не удалось создать namespace webplant'
}

$redisPasswordBase64 = Get-NativeText -AllowFailure {
    kubectl get secret webplant-secrets -n $Namespace -o jsonpath='{.data.REDIS_PASSWORD}'
}
if ($redisPasswordBase64 -and $redisPasswordBase64 -notmatch 'Error|error|not found') {
    $redisPassword = ConvertFrom-Base64 $redisPasswordBase64
    Write-Ok 'Пароль Redis взят из существующего секрета'
} else {
    $redisPassword = New-RandomPassword
    Write-Ok 'Сгенерирован новый пароль Redis'
}

$configLines = @()
foreach ($key in $envMap.Keys) {
    if ($overriddenKeys -contains $key) { continue }
    if ($secretKeys -contains $key) { continue }
    if (-not $envMap[$key]) { continue }
    $configLines += "$key=$($envMap[$key])"
}

$secretLines = @()
foreach ($key in $secretKeys) {
    if ($envMap[$key]) { $secretLines += "$key=$($envMap[$key])" }
}
$secretLines += "REDIS_PASSWORD=$redisPassword"
$secretLines += "REDIS_URL=redis://default:$redisPassword@redis:6379/0"

$configEnvFile = Join-Path $StagingDir 'webplant-env.properties'
$secretEnvFile = Join-Path $StagingDir 'webplant-secrets.properties'
Write-Utf8NoBom $configEnvFile ($configLines -join "`n")
Write-Utf8NoBom $secretEnvFile ($secretLines -join "`n")

$configYaml = Join-Path $StagingDir 'webplant-env.yaml'
$secretYaml = Join-Path $StagingDir 'webplant-secrets.yaml'
$configYamlContent = Get-NativeLines { kubectl create configmap webplant-env -n $Namespace --from-env-file=$configEnvFile --dry-run=client -o yaml }
Write-Utf8NoBom $configYaml ($configYamlContent -join "`n")
$secretYamlContent = Get-NativeLines { kubectl create secret generic webplant-secrets -n $Namespace --from-env-file=$secretEnvFile --dry-run=client -o yaml }
Write-Utf8NoBom $secretYaml ($secretYamlContent -join "`n")

Invoke-Checked 'Не удалось применить webplant-env' { kubectl apply -f $configYaml } | Out-Null
Invoke-Checked 'Не удалось применить webplant-secrets' { kubectl apply -f $secretYaml } | Out-Null
Remove-Item -LiteralPath $secretEnvFile -Force
Write-Ok 'Переменные окружения загружены в кластер'

# Текущий режим фоновых задач читаем ДО применения 10-configmap.yaml: в манифесте
# стоит безопасное значение по умолчанию (false), и оно перезаписало бы состояние
$currentJobsValue = Get-NativeText -AllowFailure {
    kubectl get configmap webplant-config -n $Namespace -o jsonpath='{.data.BACKGROUND_JOBS_ENABLED}'
}

Invoke-Checked 'Не удалось применить webplant-config' { kubectl apply -f (Join-Path $K8sDir '10-configmap.yaml') } | Out-Null
if ($EnableBackgroundJobs) {
    $jobsValue = 'true'
    $jobsNote = 'включены флагом -EnableBackgroundJobs'
} elseif ($DisableBackgroundJobs) {
    $jobsValue = 'false'
    $jobsNote = 'выключены флагом -DisableBackgroundJobs'
} elseif ($currentJobsValue -match '^(true|false)$') {
    $jobsValue = $currentJobsValue
    $jobsNote = "режим сохранён из кластера ($jobsValue)"
} else {
    $jobsValue = 'false'
    $jobsNote = 'новый кластер: по умолчанию выключены, чтобы не дублировать push'
}

# JSON передаётся файлом: Windows PowerShell 5.1 съедает кавычки в аргументах нативных команд
$jobsPatchFile = Join-Path $StagingDir 'background-jobs.patch.json'
Write-Utf8NoBom $jobsPatchFile "{`"data`":{`"BACKGROUND_JOBS_ENABLED`":`"$jobsValue`"}}"
Invoke-Checked 'Не удалось выставить BACKGROUND_JOBS_ENABLED' {
    kubectl patch configmap webplant-config -n $Namespace --type merge --patch-file $jobsPatchFile
} | Out-Null
Write-Ok "Фоновые задачи в кластере: $jobsNote"

# --- 3. Хранилища, PostgreSQL, Redis ----------------------------------------

Write-Step 'Разворачиваю хранилища, PostgreSQL и Redis'

Invoke-Checked 'Не удалось применить PVC' { kubectl apply -f (Join-Path $K8sDir '15-storage.yaml') } | Out-Null
Invoke-Checked 'Не удалось применить PostgreSQL' { kubectl apply -f (Join-Path $K8sDir '20-postgres.yaml') } | Out-Null
Invoke-Checked 'Не удалось применить Redis' { kubectl apply -f (Join-Path $K8sDir '30-redis.yaml') } | Out-Null

Invoke-Checked 'PostgreSQL не вышел в Ready за 5 минут' {
    kubectl rollout status statefulset/postgres -n $Namespace --timeout=300s
} | Out-Null
Write-Ok 'PostgreSQL готов'
Invoke-Checked 'Redis не вышел в Ready за 3 минуты' {
    kubectl rollout status deployment/redis -n $Namespace --timeout=180s
} | Out-Null
Write-Ok 'Redis готов'

# --- 4. Сборка и доставка образа -------------------------------------------

if (-not $SkipImageLoad) {
    if (-not $SkipBuild) {
        Write-Step "Собираю образ $image"
        Invoke-Checked "Не удалось собрать образ $image" {
            docker build -t $image -f (Join-Path $BackendDir 'Dockerfile') $BackendDir
        } | Out-Null
        Write-Ok "Образ $image собран"
    }

    $imageTar = "webplant-backend-$Tag.tar"
    Write-Step "Готовлю tar-архив образа ($imageTar)"
    Invoke-Checked 'Не удалось выполнить docker save' {
        docker save -o (Join-Path $StagingDir $imageTar) $image
    } | Out-Null
    Write-Ok ("Архив готов: {0:N1} МБ" -f ((Get-Item (Join-Path $StagingDir $imageTar)).Length / 1MB))

    Write-Step 'Поднимаю HTTP-сервер для раздачи образов'
    if (Test-DockerContainer $ImageServerName) {
        Invoke-Checked 'Не удалось удалить старый контейнер сервера образов' {
            docker rm -f $ImageServerName
        } | Out-Null
    }
    Invoke-Checked 'Не удалось запустить сервер образов (порт 8099 занят?)' {
        docker run -d --name $ImageServerName --restart unless-stopped `
            -p "${ImageServerPort}:80" `
            -v "${StagingDir}:/usr/share/nginx/html:ro" `
            nginx:alpine
    } | Out-Null
    Write-Ok "Сервер образов слушает http://localhost:$ImageServerPort (из подов — host.docker.internal:$ImageServerPort)"

    Write-Step 'Доставляю образ на ноды кластера'

    # Предыдущий образ оставляем на нодах как цель для kubectl rollout undo
    $currentImage = Get-NativeText -AllowFailure {
        kubectl get deployment backend -n $Namespace -o jsonpath='{.spec.template.spec.containers[0].image}'
    }
    $keepImage = ''
    if ($currentImage -match '^webplant-backend:') {
        $keepImage = "docker.io/library/$currentImage"
        Write-Ok "Предыдущий образ сохраняю для отката: $currentImage"
    }

    $loaderManifest = (Read-Utf8 (Join-Path $K8sDir 'jobs/image-loader.daemonset.yaml')).
        Replace('__IMAGE_REF__', $image).Replace('__IMAGE_TAR__', $imageTar).Replace('__KEEP_IMAGE__', $keepImage)
    $loaderPath = Join-Path $StagingDir 'image-loader.generated.yaml'
    Write-Utf8NoBom $loaderPath $loaderManifest
    Invoke-Checked 'Не удалось применить image-loader' { kubectl apply -f $loaderPath } | Out-Null

    $nodeCount = (Get-NativeLines { kubectl get nodes --no-headers }).Count
    $deadline = (Get-Date).AddMinutes(15)
    while ($true) {
        $readyNodes = 0
        foreach ($podLine in (Get-NativeLines -AllowFailure { kubectl get pods -n $Namespace -l app=image-loader --no-headers })) {
            $fields = $podLine -split '\s+'
            if ($fields.Count -lt 3) { continue }
            if ($fields[2] -notin @('Running', 'Completed')) { continue }
            $podLog = Get-NativeText -AllowFailure { kubectl logs $fields[0] -n $Namespace }
            if ($podLog -match 'image-loader ready') { $readyNodes++ }
        }

        if ($readyNodes -ge $nodeCount) {
            Write-Ok "Образ импортирован на $readyNodes нод(ы)"
            break
        }
        if ((Get-Date) -gt $deadline) {
            Write-Lines (Invoke-Native -Action { kubectl get pods -n $Namespace -l app=image-loader } -Capture).Output
            Write-Lines (Invoke-Native -Action { kubectl logs -n $Namespace -l app=image-loader --tail=20 } -Capture).Output
            throw "За 15 минут образ доставлен только на $readyNodes из $nodeCount нод"
        }
        Start-Sleep -Seconds 5
    }

    Invoke-Checked 'Не удалось удалить image-loader' {
        kubectl delete daemonset image-loader -n $Namespace --ignore-not-found
    } | Out-Null
}

# --- 5. Перенос данных из compose-стека ------------------------------------

Write-Step 'Проверяю данные в базе кластера'
$tableCountRaw = Get-NativeText -AllowFailure {
    kubectl exec -n $Namespace statefulset/postgres -- psql -U $dbUser -d $dbName -tAc "select count(*) from information_schema.tables where table_schema='public'"
}
$tableCount = 0
if ($tableCountRaw -match '^\d+$') { $tableCount = [int]$tableCountRaw }
Write-Ok "Таблиц в базе кластера: $tableCount"

if ($RestoreData -or $tableCount -eq 0) {
    Write-Step 'Переношу данные из compose-стека (только чтение)'

    if (-not (Test-DockerContainer 'ctp_postgres')) {
        throw 'Контейнер ctp_postgres не запущен — нечего переносить. Запустите compose-стек или уберите -RestoreData.'
    }

    $dbDump = 'webplant-db.dump'
    Invoke-Checked 'Не удалось снять дамп боевой базы' {
        docker exec ctp_postgres pg_dump -Fc -U $dbUser -d $dbName -f /tmp/webplant-db.dump
    } | Out-Null
    Invoke-Checked 'Не удалось скопировать дамп из контейнера' {
        docker cp "ctp_postgres:/tmp/webplant-db.dump" (Join-Path $StagingDir $dbDump)
    } | Out-Null
    Invoke-Checked 'Не удалось удалить временный дамп из контейнера' {
        docker exec ctp_postgres rm -f /tmp/webplant-db.dump
    } | Out-Null
    Write-Ok ("Дамп БД: {0:N2} МБ" -f ((Get-Item (Join-Path $StagingDir $dbDump)).Length / 1MB))

    $uploadsDir = Join-Path $BackendDir 'uploads'
    $uploadsArchive = 'webplant-uploads.tar.gz'
    if (Test-Path -LiteralPath $uploadsDir) {
        # Windows tar (bsdtar): tar в контейнере падает с "read error: Out of memory"
        # на bind-mount из папки, которую синхронизирует облако (Yandex.Disk)
        $archivePath = Join-Path $StagingDir $uploadsArchive
        Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
        $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (-not (Test-Path -LiteralPath $tarExe)) { $tarExe = 'tar.exe' }

        $tarResult = Invoke-Native -Action { & $tarExe -czf $archivePath -C $uploadsDir . } -Capture
        if ($tarResult.ExitCode -ne 0) {
            Write-WarnStep 'Windows tar не сработал — архивирую в контейнере'
            Invoke-Checked 'Не удалось собрать архив uploads' {
                docker run --rm -v "${uploadsDir}:/src:ro" -v "${StagingDir}:/out" postgres:16-alpine `
                    tar -czf "/out/$uploadsArchive" -C /src .
            } | Out-Null
        }
        Write-Ok ("Архив uploads: {0:N2} МБ" -f ((Get-Item (Join-Path $StagingDir $uploadsArchive)).Length / 1MB))
    } else {
        Write-WarnStep 'Каталог Backend/uploads не найден — фото не переносятся'
    }

    # Останавливаю реплики backend, чтобы pg_restore мог пересоздать базу
    $backendProbe = Invoke-Native -Action { kubectl get deployment backend -n $Namespace --no-headers } -Capture
    if ($backendProbe.ExitCode -eq 0) {
        Invoke-Checked 'Не удалось остановить backend перед восстановлением' {
            kubectl scale deployment backend -n $Namespace --replicas=0
        } | Out-Null
        Invoke-Checked 'Backend не остановился' {
            kubectl rollout status deployment/backend -n $Namespace --timeout=180s
        } | Out-Null
    }

    $runId = Get-Date -Format 'yyyyMMddHHmmss'

    $dbJobManifest = (Read-Utf8 (Join-Path $K8sDir 'jobs/db-restore.job.yaml')).
        Replace('__RUN_ID__', $runId).Replace('__DUMP_FILE__', $dbDump)
    $dbJobPath = Join-Path $StagingDir 'db-restore.generated.yaml'
    Write-Utf8NoBom $dbJobPath $dbJobManifest
    Invoke-Checked 'Не удалось запустить Job восстановления БД' { kubectl apply -f $dbJobPath } | Out-Null

    $restoreJob = "db-restore-$runId"
    $waitResult = Invoke-Native -Action {
        kubectl wait --for=condition=complete "job/$restoreJob" -n $Namespace --timeout=600s
    } -Capture
    Write-Lines (Invoke-Native -Action { kubectl logs "job/$restoreJob" -n $Namespace } -Capture).Output
    if ($waitResult.ExitCode -ne 0) {
        throw 'Восстановление базы не завершилось успешно'
    }
    Write-Ok 'База кластера восстановлена из боевого дампа'

    if (Test-Path -LiteralPath (Join-Path $StagingDir $uploadsArchive)) {
        $uploadsJobManifest = (Read-Utf8 (Join-Path $K8sDir 'jobs/uploads-restore.job.yaml')).
            Replace('__RUN_ID__', $runId).Replace('__ARCHIVE_FILE__', $uploadsArchive)
        $uploadsJobPath = Join-Path $StagingDir 'uploads-restore.generated.yaml'
        Write-Utf8NoBom $uploadsJobPath $uploadsJobManifest
        Invoke-Checked 'Не удалось запустить Job переноса uploads' { kubectl apply -f $uploadsJobPath } | Out-Null

        $uploadsJob = "uploads-restore-$runId"
        $uploadsWait = Invoke-Native -Action {
            kubectl wait --for=condition=complete "job/$uploadsJob" -n $Namespace --timeout=600s
        } -Capture
        Write-Lines (Invoke-Native -Action { kubectl logs "job/$uploadsJob" -n $Namespace } -Capture).Output
        if ($uploadsWait.ExitCode -ne 0) {
            throw 'Перенос uploads не завершился успешно'
        }
        Write-Ok 'Каталог uploads перенесён в том кластера'
    }
} else {
    Write-Ok 'Данные в базе уже есть — перенос не требуется (для принудительного переноса: -RestoreData)'
}

# --- 6. Backend --------------------------------------------------------------

Write-Step "Разворачиваю backend ($image, реплик: $Replicas)"

$backendManifest = (Read-Utf8 (Join-Path $K8sDir '40-backend.yaml')).Replace('__TAG__', $Tag)
$backendPath = Join-Path $StagingDir 'backend.generated.yaml'
Write-Utf8NoBom $backendPath $backendManifest
Invoke-Checked 'Не удалось применить backend' { kubectl apply -f $backendPath } | Out-Null
Invoke-Checked 'Не удалось выставить количество реплик' {
    kubectl scale deployment backend -n $Namespace --replicas=$Replicas
} | Out-Null
Invoke-Checked 'Backend не вышел в Ready за 5 минут' {
    kubectl rollout status deployment/backend -n $Namespace --timeout=300s
} | Out-Null
Write-Ok 'Backend готов'

# --- 7. Gateway наружу -------------------------------------------------------

if (-not $SkipGateway) {
    Write-Step "Поднимаю gateway (localhost:$GatewayPort → backend в кластере)"

    # Именами нод, а не IP: при пересоздании кластера адреса меняются, имена — нет
    $nodeNames = @()
    foreach ($line in (Get-NativeLines { kubectl get nodes -o wide --no-headers })) {
        $fields = $line -split '\s+'
        if ($fields.Count -ge 6 -and $fields[1] -eq 'Ready') { $nodeNames += $fields[0] }
    }
    if (-not $nodeNames.Count) { throw 'Не найдено ни одной Ready-ноды' }

    $upstreams = ($nodeNames | ForEach-Object { "        server ${_}:$NodePort max_fails=2 fail_timeout=5s;" }) -join "`n"
    $gatewayConf = (Read-Utf8 (Join-Path $K8sDir 'gateway/nginx.conf.tpl')).Replace('__UPSTREAM_SERVERS__', $upstreams)
    $gatewayConfPath = Join-Path $StagingDir 'gateway-nginx.conf'
    Write-Utf8NoBom $gatewayConfPath $gatewayConf

    Invoke-Checked 'Не удалось удалить старый gateway' { docker rm -f $GatewayName } | Out-Null
    Invoke-Checked "Не удалось запустить gateway (порт $GatewayPort занят?)" {
        docker run -d --name $GatewayName --restart unless-stopped `
            --network kind `
            -p "${GatewayPort}:${GatewayPort}" `
            -v "${gatewayConfPath}:/etc/nginx/nginx.conf:ro" `
            nginx:alpine
    } | Out-Null
    $composeNetwork = Get-NativeLines -AllowFailure { docker network ls --filter "name=^${ComposeProjectNetwork}$" --format '{{.Name}}' }
    if ($composeNetwork.Count) {
        # Docker Desktop иногда отдаёт "network sandbox not found" сразу после старта
        # контейнера — повторяем подключение и не считаем это фатальной ошибкой.
        $connected = $false
        $lastConnectError = ''
        for ($attempt = 1; $attempt -le 3 -and -not $connected; $attempt++) {
            $connectResult = Invoke-Native -Action { docker network connect $ComposeProjectNetwork $GatewayName } -Capture
            if ($connectResult.ExitCode -eq 0) {
                $connected = $true
                break
            }
            $lastConnectError = ($connectResult.Output | Out-String).Trim()
            if ($lastConnectError -match 'already exists') {
                $connected = $true
                break
            }
            Start-Sleep -Seconds 3
        }

        if ($connected) {
            Write-Ok "Gateway доступен compose-стеку как http://${GatewayName}:$GatewayPort"
        } else {
            Write-WarnStep "Gateway не подключён к сети ${ComposeProjectNetwork}: $lastConnectError"
        }
    }
    Write-Ok "Gateway доступен с хоста: http://localhost:$GatewayPort (нод в апстриме: $($nodeNames.Count))"
}

# --- 8. Проверка -------------------------------------------------------------

# Если боевой nginx уже ходит в кластер, после пересоздания gateway нужен reload:
# контейнер получил новый IP, а nginx держит DNS-кэш до 10 секунд.
if (-not $SkipGateway) {
    $activeNginxConf = Join-Path $BackendDir 'nginx\conf.d\default.conf'
    if ((Test-Path -LiteralPath $activeNginxConf) -and ((Read-Utf8 $activeNginxConf) -match 'ctp_k8s_gateway')) {
        $reloadResult = Invoke-Native -Action { docker exec ctp_nginx nginx -s reload } -Capture
        if ($reloadResult.ExitCode -eq 0) {
            Write-Ok 'nginx перезагружен: сброшен кэш DNS для пересозданного gateway'
        } else {
            Write-WarnStep "Не удалось перезагрузить nginx: $(($reloadResult.Output | Out-String).Trim())"
        }
    }
}

Write-Step 'Проверяю результат'

Write-Lines (Invoke-Native -Action { kubectl get pods -n $Namespace -o wide } -Capture).Output

if (-not $SkipGateway) {
    # Поды только что перезапустились — даём им время пройти startupProbe.
    # Проверяем из контейнера nginx (compose-сеть): опубликованный на хост порт
    # в Docker Desktop устанавливается с задержкой и для диагностики ненадёжен.
    $health = $null
    $lastHealthError = ''
    for ($attempt = 1; $attempt -le 10 -and -not $health; $attempt++) {
        Start-Sleep -Seconds 3

        $viaNginx = Invoke-Native -Action {
            docker exec ctp_nginx sh -c "wget -qO- -T 8 http://${GatewayName}:${GatewayPort}/health"
        } -Capture
        $body = ($viaNginx.Output | Out-String).Trim()
        if ($viaNginx.ExitCode -eq 0 -and $body -match '"status"') {
            try { $health = $body | ConvertFrom-Json } catch { $lastHealthError = $_.Exception.Message }
            continue
        }

        $lastHealthError = $body
        try {
            $health = Invoke-RestMethod -Uri "http://localhost:$GatewayPort/health" -TimeoutSec 15
        } catch {
            $lastHealthError = $_.Exception.Message
        }
    }

    if ($health) {
        Write-Ok ("/health: status={0}, deployTarget={1}, redis={2}, backgroundJobs={3}" -f `
            $health.status, $health.deployTarget, $health.redis, $health.backgroundJobs)
    } else {
        Write-WarnStep "Не удалось проверить /health через gateway: $lastHealthError"
    }
}

$redisReply = Get-NativeText -AllowFailure {
    kubectl exec -n $Namespace deployment/redis -- sh -c 'redis-cli dbsize'
}
if ($redisReply -match '^\d+$') {
    Write-Ok "Redis отвечает, ключей: $redisReply"
} else {
    Write-WarnStep "Redis не ответил на dbsize: $redisReply"
}

Write-Host ''
Write-Host 'Готово. Полезные команды:' -ForegroundColor Cyan
Write-Host "  kubectl get pods -n $Namespace"
Write-Host "  kubectl logs -n $Namespace deployment/backend --tail=50"
# Пути абсолютные: команды можно копировать из любого каталога
Write-Host "  powershell -File `"$PSScriptRoot\status.ps1`""
Write-Host "  powershell -File `"$PSScriptRoot\switch-traffic.ps1`" -Target compose   # откат трафика"
Write-Host "  kubectl rollout undo deployment/backend -n $Namespace   # откат на предыдущий образ"
