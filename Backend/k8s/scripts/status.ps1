#Requires -Version 5.1
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
$redisInfo = Get-NativeOutput -AllowFailure {
    kubectl exec -n $Namespace deployment/redis -- sh -c 'redis-cli dbsize; redis-cli info memory | grep -E ''used_memory_human|maxmemory_human''; echo -n ''ключей ctp:ai: ''; redis-cli --scan --pattern ''ctp:ai:*'' | wc -l; echo -n ''ключей ctp:rl: ''; redis-cli --scan --pattern ''ctp:rl:*'' | wc -l; echo -n ''активных локов: ''; redis-cli --scan --pattern ''ctp:lock:*'' | wc -l'
}
Write-Host $redisInfo

Write-Step 'Данные PostgreSQL'
$dbInfo = Get-NativeOutput -AllowFailure {
    kubectl exec -n $Namespace statefulset/postgres -- sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c ''select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 8'''
}
Write-Host $dbInfo

Write-Step 'Схема базы и миграции'
$schemaSql = "select (select count(*) from information_schema.tables where table_schema = 'public') || '|' || " +
    "(select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'site_visit_days') || '|' || " +
    "(select count(*) from information_schema.columns where table_name = 'users' and column_name = 'created_at');"
$schemaRaw = ($schemaSql | kubectl exec -i -n $Namespace statefulset/postgres -- sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -tA' 2>&1 | Out-String).Trim()
Write-Host $schemaRaw

if ($schemaRaw -match '^(\d+)\|(\d+)\|(\d+)$') {
    $tables = [int]$Matches[1]
    $visitsTable = [int]$Matches[2]
    $createdAtColumn = [int]$Matches[3]
    Write-Host ("таблиц: {0}, site_visit_days: {1}, users.created_at: {2}" -f `
        $tables, $(if ($visitsTable) { 'есть' } else { 'нет' }), $(if ($createdAtColumn) { 'есть' } else { 'нет' }))

    if (-not $visitsTable -or -not $createdAtColumn) {
        Write-Host 'Схема отстала от кода: поды backend будут падать с "Database schema is missing required tables".' -ForegroundColor Yellow
        Write-Host 'Примените миграции: powershell -File Backend/scripts/apply-migrations.ps1' -ForegroundColor Yellow
        Write-Host 'Затем: kubectl rollout restart deployment/backend -n webplant' -ForegroundColor Yellow
    }
} else {
    Write-Host 'не удалось прочитать схему (кластер недоступен?)' -ForegroundColor Yellow
}

Write-Step 'Логи backend, если поды не в Ready'
$notReady = (kubectl get pods -n $Namespace -l app=webplant-backend --no-headers 2>$null) |
    Where-Object { $_ -notmatch 'Running' -or $_ -notmatch '\s1/1\s' }
if ($notReady) {
    $notReady | ForEach-Object { Write-Host $_ }
    kubectl logs -n $Namespace deployment/backend --tail=30 --all-containers=true 2>&1 | Select-Object -Last 30
} else {
    Write-Host 'все реплики backend в Running/Ready (или подов нет)'
}

Write-Step 'Внешние контейнеры-мостики'
docker ps --filter 'name=ctp_k8s_' --format '{{.Names}}  {{.Status}}  {{.Ports}}'
