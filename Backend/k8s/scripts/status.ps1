#Requires -Version 5.1
<#
.SYNOPSIS
    Состояние стека WebPlant в Kubernetes: поды, сервисы, тома, данные, Redis, health.

.EXAMPLE
    powershell -File Backend/k8s/scripts/status.ps1
#>
[CmdletBinding()]
param(
    [string]$Namespace = 'webplant',
    [int]$GatewayPort = 8090
)

$ErrorActionPreference = 'Continue'

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Get-NativeOutput {
    param([Parameter(Mandatory)][scriptblock]$Action, [switch]$AllowFailure)
    $output = & $Action 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "Команда завершилась с кодом $LASTEXITCODE`: $output" }
    return (($output | Out-String).Trim())
}

Write-Step 'Поды'
kubectl get pods -n $Namespace -o wide

Write-Step 'Сервисы и точки входа'
kubectl get svc,endpoints -n $Namespace

Write-Step 'Тома'
kubectl get pvc -n $Namespace

Write-Step 'Деплойменты'
kubectl get deployments,statefulsets -n $Namespace

Write-Step 'Health backend (изнутри кластера)'
$health = Get-NativeOutput -AllowFailure {
    kubectl exec -n $Namespace deployment/backend -- node -e "fetch('http://127.0.0.1:5000/health').then(r => r.text()).then(t => console.log(t)).catch(e => { console.log('ERR ' + e.message); process.exit(1) })"
}
if ($LASTEXITCODE -eq 0) {
    Write-Host $health
} else {
    Write-Host "не удалось: $health" -ForegroundColor Yellow
}

Write-Step 'Health backend (через gateway)'
# Из контейнера nginx (compose-сеть) — надёжнее опубликованного на хост порта
$viaNginx = Get-NativeOutput -AllowFailure {
    docker exec ctp_nginx sh -c "wget -qO- -T 8 http://ctp_k8s_gateway:$GatewayPort/health"
}
if ($viaNginx -match '"status"') {
    Write-Host $viaNginx
} else {
    try {
        $viaGateway = Invoke-RestMethod -Uri "http://localhost:$GatewayPort/health" -TimeoutSec 10
        Write-Host ("status={0} deployTarget={1} redis={2} backgroundJobs={3}" -f `
            $viaGateway.status, $viaGateway.deployTarget, $viaGateway.redis, $viaGateway.backgroundJobs)
    } catch {
        Write-Host "gateway недоступен: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Step 'Redis'
# Внутри sh используем только одинарные кавычки: Windows PowerShell 5.1 ломает
# двойные кавычки в аргументах нативных команд.
$redisInfo = Get-NativeOutput -AllowFailure {
    kubectl exec -n $Namespace deployment/redis -- sh -c 'redis-cli dbsize; redis-cli info memory | grep -E ''used_memory_human|maxmemory_human''; echo -n ''ключей ctp:ai: ''; redis-cli --scan --pattern ''ctp:ai:*'' | wc -l; echo -n ''ключей ctp:rl: ''; redis-cli --scan --pattern ''ctp:rl:*'' | wc -l; echo -n ''активных локов: ''; redis-cli --scan --pattern ''ctp:lock:*'' | wc -l'
}
Write-Host $redisInfo

Write-Step 'Данные PostgreSQL'
$dbInfo = Get-NativeOutput -AllowFailure {
    kubectl exec -n $Namespace statefulset/postgres -- sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c ''select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 8'''
}
Write-Host $dbInfo

Write-Step 'Внешние контейнеры-мостики'
docker ps --filter 'name=ctp_k8s_' --format '{{.Names}}  {{.Status}}  {{.Ports}}'
