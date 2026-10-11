#Requires -Version 5.1
<#
.SYNOPSIS
    Возврат данных из Kubernetes в compose-стек (откат после полного переезда).

.DESCRIPTION
    После `switch-traffic.ps1 -Target k8s` источником правды становится стек в
    кластере, поэтому обычный откат (compose) показал бы устаревшие данные.
    Этот скрипт переносит обратно:
      1) дамп базы из PostgreSQL кластера → в PostgreSQL compose-стека;
      2) каталог uploads из PVC кластера → в Backend/uploads.
    Compose-backend на время восстановления останавливается и поднимается обратно.

.PARAMETER SkipUploads
    Перенести только базу.

.PARAMETER KeepBackendStopped
    Не поднимать compose-backend после восстановления (например, если трафик
    остаётся в кластере).

.EXAMPLE
    powershell -File Backend/k8s/scripts/restore-back.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipUploads,
    [switch]$KeepBackendStopped
)

$ErrorActionPreference = 'Stop'

$K8sDir = Split-Path -Parent $PSScriptRoot
$BackendDir = Split-Path -Parent $K8sDir
$RepoRoot = Split-Path -Parent $BackendDir
$StagingDir = Join-Path $RepoRoot '.k8s-images'
$Namespace = 'webplant'

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

function Invoke-Native {
    param([Parameter(Mandatory)][scriptblock]$Action, [switch]$Capture)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @()
    try {
        if ($Capture) { $output = @(& $Action 2>&1) } else { & $Action 2>&1 | Out-Null }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ ExitCode = [int]$code; Output = $output }
}

function Invoke-Checked {
    param([Parameter(Mandatory)][string]$What, [Parameter(Mandatory)][scriptblock]$Action)
    $result = Invoke-Native -Action $Action -Capture
    if ($result.ExitCode -ne 0) {
        foreach ($line in $result.Output) { Write-Host $line }
        throw "$What (код $($result.ExitCode))"
    }
    return $result.Output
}

function Read-DotEnv([string]$Path) {
    $map = [ordered]@{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $index = $trimmed.IndexOf('=')
        if ($index -lt 1) { continue }
        $map[$trimmed.Substring(0, $index).Trim()] = $trimmed.Substring($index + 1).Trim()
    }
    return $map
}

function Get-NativeText {
    param([Parameter(Mandatory)][scriptblock]$Action, [switch]$AllowFailure)
    $result = Invoke-Native -Action $Action -Capture
    if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
        throw "Команда завершилась с кодом $($result.ExitCode): $(($result.Output | Out-String).Trim())"
    }
    return (($result.Output | Out-String).Trim())
}

if (-not (Test-Path -LiteralPath $StagingDir)) {
    New-Item -ItemType Directory -Path $StagingDir | Out-Null
}

$envMap = Read-DotEnv (Join-Path $BackendDir '.env')
$dbName = $envMap['DB_NAME']
$dbUser = $envMap['DB_USER']

Write-Step 'Проверяю окружение'
$postgresPod = Get-NativeText { kubectl get pods -n $Namespace -l app=postgres -o jsonpath='{.items[0].metadata.name}' }
if (-not $postgresPod) { throw 'Не найден под PostgreSQL в кластере' }
Write-Ok "PostgreSQL в кластере: $postgresPod"

$composePostgres = Get-NativeText -AllowFailure { docker ps --filter 'name=ctp_postgres' --format '{{.Names}}' }
if ($composePostgres -ne 'ctp_postgres') { throw 'Контейнер ctp_postgres не запущен — запустите compose-стек' }
Write-Ok 'Compose PostgreSQL доступен'

$backendPod = Get-NativeText -AllowFailure { kubectl get pods -n $Namespace -l app=webplant-backend -o jsonpath='{.items[0].metadata.name}' }

Write-Step 'Снимаю дамп базы из кластера'
$dumpFile = 'webplant-k8s-back.dump'
$dumpPath = Join-Path $StagingDir $dumpFile
Invoke-Checked 'Не удалось снять дамп в кластере' {
    kubectl exec -n $Namespace $postgresPod -- pg_dump -Fc -U $dbUser -d $dbName -f /tmp/webplant-back.dump
} | Out-Null
Invoke-Checked 'Не удалось скопировать дамп из пода' {
    kubectl cp "$Namespace/${postgresPod}:/tmp/webplant-back.dump" $dumpPath
} | Out-Null
Invoke-Checked 'Не удалось удалить временный дамп в кластере' {
    kubectl exec -n $Namespace $postgresPod -- rm -f /tmp/webplant-back.dump
} | Out-Null
Write-Ok ("Дамп кластера: {0:N2} МБ" -f ((Get-Item $dumpPath).Length / 1MB))

Write-Step 'Останавливаю compose-backend на время восстановления'
$stopResult = Invoke-Native -Action { docker stop ctp_backend } -Capture
if ($stopResult.ExitCode -ne 0) { Write-WarnStep 'ctp_backend не был запущен — продолжаю' }

Write-Step 'Восстанавливаю базу в compose-стеке'
Invoke-Checked 'Не удалось скопировать дамп в контейнер' {
    docker cp $dumpPath "ctp_postgres:/tmp/webplant-back.dump"
} | Out-Null
Invoke-Checked 'Не удалось пересоздать базу compose-стека' {
    docker exec ctp_postgres dropdb --if-exists --force -U $dbUser $dbName
    if ($LASTEXITCODE -ne 0) { throw 'dropdb завершился с ошибкой' }
    docker exec ctp_postgres createdb -U $dbUser $dbName
} | Out-Null
Invoke-Checked 'Не удалось восстановить дамп в compose-базу' {
    docker exec ctp_postgres pg_restore --no-owner --no-privileges --exit-on-error -U $dbUser -d $dbName /tmp/webplant-back.dump
} | Out-Null
Invoke-Checked 'Не удалось удалить временный дамп в контейнере' {
    docker exec ctp_postgres rm -f /tmp/webplant-back.dump
} | Out-Null
$tableCount = Get-NativeText -AllowFailure {
    docker exec ctp_postgres psql -U $dbUser -d $dbName -tAc "select count(*) from information_schema.tables where table_schema='public'"
}
Write-Ok "Compose-база восстановлена, таблиц: $tableCount"

if (-not $SkipUploads) {
    Write-Step 'Переношу uploads из кластера в compose'

    if (-not $backendPod) {
        Write-WarnStep 'Под backend в кластере не найден — фото не переношу'
    } else {
        $archiveName = 'webplant-k8s-uploads.tar.gz'
        $archivePath = Join-Path $StagingDir $archiveName
        Invoke-Checked 'Не удалось собрать архив uploads в кластере' {
            kubectl exec -n $Namespace $backendPod -- tar -czf /tmp/uploads-back.tar.gz -C /app/uploads .
        } | Out-Null
        Invoke-Checked 'Не удалось скопировать архив из пода' {
            kubectl cp "$Namespace/${backendPod}:/tmp/uploads-back.tar.gz" $archivePath
        } | Out-Null
        Invoke-Checked 'Не удалось удалить временный архив в кластере' {
            kubectl exec -n $Namespace $backendPod -- rm -f /tmp/uploads-back.tar.gz
        } | Out-Null

        $uploadsDir = Join-Path $BackendDir 'uploads'
        if (-not (Test-Path -LiteralPath $uploadsDir)) {
            New-Item -ItemType Directory -Path $uploadsDir | Out-Null
        }

        # Windows tar (bsdtar) надёжнее контейнерного на облачной папке-монтировании
        $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (-not (Test-Path -LiteralPath $tarExe)) { $tarExe = 'tar.exe' }
        $extractResult = Invoke-Native -Action { & $tarExe -xzf $archivePath -C $uploadsDir } -Capture

        if ($extractResult.ExitCode -ne 0) {
            Write-WarnStep 'Windows tar не сработал — распаковываю в контейнере'
            Invoke-Checked 'Не удалось распаковать архив uploads' {
                docker run --rm -v "${uploadsDir}:/dst" -v "${StagingDir}:/src:ro" postgres:16-alpine `
                    tar -xzf "/src/$archiveName" -C /dst
            } | Out-Null
        }

        $fileCount = (Get-ChildItem -LiteralPath $uploadsDir -Recurse -File | Measure-Object).Count
        Write-Ok "Файлов в Backend/uploads: $fileCount"
    }
}

Write-Step 'Возвращаю compose-backend'
if ($KeepBackendStopped) {
    Write-WarnStep 'Оставлен остановленным (-KeepBackendStopped)'
} else {
    Invoke-Checked 'Не удалось запустить ctp_backend' { docker start ctp_backend } | Out-Null
    Start-Sleep -Seconds 8
    $health = Get-NativeText -AllowFailure {
        docker exec ctp_nginx sh -c 'wget -qO- -T 8 --no-check-certificate https://server.checktheplants.ru/health'
    }
    Write-Host "  /health: $health"
}

Write-Host ''
Write-Host 'Готово. Не забудьте выставить режим трафика:' -ForegroundColor Cyan
Write-Host '  powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose'
