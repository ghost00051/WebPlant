#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('k8s', 'compose')]
    [string]$Target = 'k8s',
    [string]$Namespace = 'webplant',
    [string]$Container = 'ctp_postgres',
    [string]$From
)

$ErrorActionPreference = 'Stop'

$BackendDir = Split-Path -Parent $PSScriptRoot
$MigrationsDir = Join-Path $BackendDir 'migrations'

function Write-Ok([string]$Text) { Write-Host "  OK  $Text" -ForegroundColor Green }
function Write-Fail([string]$Text) { Write-Host "  !!  $Text" -ForegroundColor Red }

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

function Invoke-Sql([string]$Sql) {
    $previousPreference = $ErrorActionPreference
    $previousEncoding = $OutputEncoding
    $ErrorActionPreference = 'Continue'

    try {
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        if ($Target -eq 'k8s') {
            $output = @($Sql | kubectl exec -i -n $Namespace statefulset/postgres -- `
                psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -q 2>&1)
        } else {
            $output = @($Sql | docker exec -i $Container `
                psql -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -q 2>&1)
        }
        $code = $LASTEXITCODE
    } finally {
        $OutputEncoding = $previousEncoding
        $ErrorActionPreference = $previousPreference
    }

    return [pscustomobject]@{
        ExitCode = [int]$code
        Output   = $output
    }
}

$envMap = Read-DotEnv (Join-Path $BackendDir '.env')
$dbName = $envMap['DB_NAME']
$dbUser = $envMap['DB_USER']
foreach ($required in @('DB_NAME', 'DB_USER')) {
    if (-not $envMap[$required]) { throw "В Backend/.env не задано $required" }
}

if (-not (Test-Path -LiteralPath $MigrationsDir)) {
    throw "Не найдена папка миграций: $MigrationsDir"
}

$files = @(Get-ChildItem -LiteralPath $MigrationsDir -Filter '*.sql' -File | Sort-Object Name)
if ($From) {
    $files = @($files | Where-Object { $_.Name -ge $From })
}
if (-not $files.Count) {
    throw "В $MigrationsDir нет подходящих .sql-файлов$(if ($From) { " (фильтр -From $From)" })"
}

Write-Host ''
Write-Host "=== Применяю миграции ($Target, база $dbName, пользователь $dbUser) ===" -ForegroundColor Cyan

if ($Target -eq 'k8s') {
    $ready = $null
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $ready = @(kubectl get pod -n $Namespace -l app=postgres -o jsonpath='{.items[0].status.phase}' 2>&1)
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($ready -notcontains 'Running') {
        throw "PostgreSQL в namespace $Namespace не найден или не в Running. Проверьте контекст kubectl ($((kubectl config current-context 2>&1) -join ' '))."
    }
} else {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $running = @(docker ps --filter "name=^${Container}$" --format '{{.Names}}' 2>&1)
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($running -notcontains $Container) {
        throw "Контейнер $Container не запущен. Запустите compose-стек: docker compose up -d postgres"
    }
}

$precheck = Invoke-Sql "select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'users';"
$precheckText = ($precheck.Output | Out-String).Trim()
if ($precheck.ExitCode -ne 0) {
    foreach ($line in $precheck.Output) { Write-Host "      $line" }
    throw "Не удалось проверить схему базы (код $($precheck.ExitCode))"
}
if ($precheckText -notmatch '(^|\s)1(\s|$)') {
    throw ('В базе нет таблицы users — это пустая база, достраивать нечего. ' +
        'Сначала восстановите данные (pg_restore дампа из Backend/backups или перенос из compose-стека), ' +
        'либо создайте базовую схему в непроизводственном режиме (NODE_ENV=development, sequelize.sync), ' +
        'затем повторите миграции.')
}

foreach ($file in $files) {
    $sql = [System.IO.File]::ReadAllText($file.FullName, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  ... $($file.Name)" -NoNewline
    $result = Invoke-Sql $sql
    if ($result.ExitCode -ne 0) {
        Write-Host '  ОШИБКА' -ForegroundColor Red
        foreach ($line in $result.Output) { Write-Host "      $line" }
        throw "Миграция $($file.Name) не применилась (код $($result.ExitCode))"
    }
    Write-Host '  ok' -ForegroundColor Green
}

$countResult = Invoke-Sql "select count(*) from information_schema.tables where table_schema = 'public';"
$countText = ($countResult.Output | Out-String).Trim()
$tableCount = ($countText -split '\s+' | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1)
Write-Ok "Миграций применено: $($files.Count)$(if ($tableCount) { ", таблиц в базе: $tableCount" })"
