#Requires -Version 5.1
<#
.SYNOPSIS
    Переключение боевого трафика между compose-стеком и Kubernetes.

.DESCRIPTION
    Меняет Backend/nginx/conf.d/default.conf на выбранный режим, проверяет
    конфигурацию через `nginx -t` и перезагружает nginx (graceful reload,
    без разрыва активных соединений). При неудачной проверке возвращает
    предыдущий файл, поэтому домен не остаётся без рабочей конфигурации.

    Режимы:
      compose — всё обслуживает compose-стек (исходное состояние, полный откат);
      canary  — /api и /uploads остаются на compose, /health уходит в Kubernetes
                (проверка связки с кластером на живом домене без риска для данных);
      k8s     — /api, /uploads и /health обслуживает стек в Kubernetes.

    ВАЖНО про режим k8s: backend в кластере работает со своей копией базы.
    Перед переключением перенесите свежие данные:
      powershell -File Backend/k8s/scripts/deploy.ps1 -RestoreData -EnableBackgroundJobs

.PARAMETER Target
    compose | canary | k8s

.EXAMPLE
    powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target canary

.EXAMPLE
    powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('compose', 'canary', 'k8s')]
    [string]$Target,
    [string]$Domain = 'server.checktheplants.ru',
    [string]$NginxContainer = 'ctp_nginx'
)

$ErrorActionPreference = 'Stop'

$K8sDir = Split-Path -Parent $PSScriptRoot
$BackendDir = Split-Path -Parent $K8sDir
$ConfDir = Join-Path $BackendDir 'nginx\conf.d'
$ActiveConf = Join-Path $ConfDir 'default.conf'
$SourceConf = Join-Path $K8sDir "nginx\$Target.conf"

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

function Get-Health {
    $result = Invoke-Native -Action {
        docker exec $NginxContainer sh -c "wget -qO- -T 8 --no-check-certificate https://$Domain/health"
    } -Capture
    return (($result.Output | Out-String).Trim())
}

function Get-StackName([string]$HealthJson) {
    # Основной признак — DEPLOY_TARGET из конфигурации стека,
    # запасной — backgroundJobs (у k8s-стека задачи обычно выключены)
    if ($HealthJson -match '"deployTarget"\s*:\s*"kubernetes"') { return 'kubernetes' }
    if ($HealthJson -match '"deployTarget"\s*:\s*"compose"') { return 'compose' }
    if ($HealthJson -match '"backgroundJobs"\s*:\s*false') { return 'kubernetes' }
    if ($HealthJson -match '"status"\s*:\s*"ok"') { return 'compose' }
    return 'неизвестно'
}

Write-Step "Переключаю трафик в режим '$Target'"

if (-not (Test-Path -LiteralPath $SourceConf)) {
    throw "Не найден конфиг $SourceConf"
}

$previousConf = $null
if (Test-Path -LiteralPath $ActiveConf) {
    $previousConf = [System.IO.File]::ReadAllText($ActiveConf)
}
$previousHealth = Get-Health
Write-Host "Текущий ответ /health: $previousHealth"

$backupDir = Join-Path $K8sDir 'nginx\backups'
if (-not (Test-Path -LiteralPath $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}
if ($previousConf) {
    $backupName = "default.conf.$(Get-Date -Format 'yyyyMMddHHmmss').bak"
    [System.IO.File]::WriteAllText((Join-Path $backupDir $backupName), $previousConf, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Предыдущий конфиг сохранён: nginx/backups/$backupName"
}

$newConf = [System.IO.File]::ReadAllText($SourceConf)
[System.IO.File]::WriteAllText($ActiveConf, $newConf, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "Установлен конфиг nginx/$Target.conf"

Write-Step 'Проверяю конфигурацию nginx'
$test = Invoke-Native -Action { docker exec $NginxContainer nginx -t } -Capture
($test.Output | Out-String).Trim() -split "`n" | ForEach-Object { Write-Host "  $_" }

if ($test.ExitCode -ne 0) {
    if ($previousConf) {
        [System.IO.File]::WriteAllText($ActiveConf, $previousConf, (New-Object System.Text.UTF8Encoding($false)))
        Write-WarnStep 'Конфигурация невалидна — вернул предыдущий файл (nginx не перезагружался)'
    }
    throw 'nginx -t завершился с ошибкой, переключение отменено'
}
Write-Ok 'Конфигурация валидна'

Write-Step 'Перезагружаю nginx (graceful reload)'
$reload = Invoke-Native -Action { docker exec $NginxContainer nginx -s reload } -Capture
if ($reload.ExitCode -ne 0) {
    ($reload.Output | Out-String).Trim() -split "`n" | ForEach-Object { Write-Host "  $_" }
    throw 'Не удалось перезагрузить nginx'
}
Write-Ok 'nginx перезагружен'

Write-Step 'Проверяю результат'
Start-Sleep -Seconds 3
$health = Get-Health
Write-Host "  /health: $health"
$servedBy = Get-StackName $health
Write-Ok "Домен обслуживает: $servedBy"

switch ($Target) {
    'compose' { if ($servedBy -ne 'compose') { Write-WarnStep 'Ожидался compose-стек — проверьте конфиг и логи nginx' } }
    'canary' { if ($servedBy -ne 'kubernetes') { Write-WarnStep 'Ожидался ответ из Kubernetes — проверьте ctp_k8s_gateway' } }
    'k8s' { if ($servedBy -ne 'kubernetes') { Write-WarnStep 'Ожидался ответ из Kubernetes — проверьте ctp_k8s_gateway и поды backend' } }
}

Write-Host ''
Write-Host 'Проверка API и фото:' -ForegroundColor Cyan
Write-Host "  docker exec $NginxContainer sh -c 'wget -qO- -T 8 --no-check-certificate https://$Domain/api/plants/need-watering'"
Write-Host ''
Write-Host 'Откат: powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose' -ForegroundColor Cyan
