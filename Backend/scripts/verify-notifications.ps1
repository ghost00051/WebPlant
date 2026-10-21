#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Namespace = 'webplant',
    [string]$PostgresPod = 'postgres-0',
    [string]$SmokeDb = 'webplant_notif_smoke_verify',
    [int]$TimeoutSec = 180,
    [switch]$SkipIdempotency,
    [switch]$SkipSmoke
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

if ($SmokeDb -notmatch '^webplant_notif_smoke[a-z0-9_]*$') {
    throw "SmokeDb must match ^webplant_notif_smoke[a-z0-9_]*$, got '$SmokeDb'"
}

$script:Failures = [System.Collections.Generic.List[string]]::new()

function Write-Ok([string]$Message) {
    Write-Host "  ✔ $Message" -ForegroundColor Green
}

function Write-Bad([string]$Message) {
    Write-Host "  ✖ $Message" -ForegroundColor Red
    $script:Failures.Add($Message)
}

function Write-Section([string]$Message) {
    Write-Host ""
    Write-Host "== $Message" -ForegroundColor Cyan
}

function Invoke-Kubectl {
    param(
        [Parameter(Mandatory)][string[]]$KubeArgs,
        [string]$StdIn
    )

    $kubectlArgs = @('-n', $Namespace) + $KubeArgs
    if ($PSBoundParameters.ContainsKey('StdIn') -and $null -ne $StdIn) {
        $raw = $StdIn | & kubectl @kubectlArgs 2>&1
    } else {
        $raw = & kubectl @kubectlArgs 2>&1
    }
    $exit = $LASTEXITCODE
    $lines = @($raw | ForEach-Object { "$_" })
    return [pscustomobject]@{ Output = $lines; ExitCode = $exit; Text = ($lines -join "`n") }
}

function Invoke-Psql {
    param([Parameter(Mandatory)][string]$Sql)
    return Invoke-Kubectl -StdIn $Sql -KubeArgs @(
        'exec', '-i', $PostgresPod, '--',
        'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -v ON_ERROR_STOP=1'
    )
}

Write-Section "0. Окружение"

$context = (& kubectl config current-context 2>&1) -join ''
if ($LASTEXITCODE -ne 0) {
    Write-Bad "kubectl недоступен: $context"
    exit 1
}
Write-Ok "kubectl context: $context"

$podQuery = Invoke-Kubectl -KubeArgs @(
    'get', 'pods', '-l', 'app=webplant-backend',
    '-o', 'jsonpath={.items[0].metadata.name}'
)
$pod = $podQuery.Text.Trim()
if ($podQuery.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($pod)) {
    Write-Bad "не найден под backend (label app=webplant-backend)"
    exit 1
}
Write-Ok "под backend: $pod"

Write-Section "1. Health внутри пода"

$healthScript = "fetch('http://127.0.0.1:5000/health').then(r=>r.text()).then(t=>console.log(t)).then(()=>process.exit(0))"
$health = Invoke-Kubectl -KubeArgs @('exec', $pod, '--', 'node', '-e', $healthScript)
$healthChecks = @{
    '"status":"ok"'          = 'status=ok'
    '"redis":"ok"'           = 'redis=ok'
    '"deployTarget":"kubernetes"' = 'deployTarget=kubernetes'
    '"backgroundJobs":true'  = 'backgroundJobs=true'
    '"push":{"configured":true,"valid":true,"error":null}' = 'push configured+valid'
}
foreach ($needle in $healthChecks.Keys) {
    if ($health.Text.Contains($needle)) {
        Write-Ok $healthChecks[$needle]
    } else {
        Write-Bad "health: ожидалось $needle"
    }
}
if ($script:Failures.Count -gt 0) {
    Write-Host "  health raw: $($health.Text)"
}

if (-not $SkipIdempotency) {
    Write-Section "2. Unique-индекс идемпотентности (BEGIN … ROLLBACK)"

    $probeKey = 'tx-probe-' + [guid]::NewGuid().ToString('N')
    if ($probeKey -notmatch '^[a-z0-9-]+$') {
        throw "unexpected probe key: $probeKey"
    }

    $probeSql = @"
BEGIN;
DO `$do`$
DECLARE
  probe_key text := '$probeKey';
BEGIN
  INSERT INTO push_broadcasts (title, body, target_mode, status, idempotency_key)
  VALUES ('tx-probe', 'tx-probe', 'all', 'pending', probe_key);

  BEGIN
    INSERT INTO push_broadcasts (title, body, target_mode, status, idempotency_key)
    VALUES ('tx-probe', 'tx-probe', 'all', 'pending', probe_key);
    RAISE EXCEPTION 'unique index NOT enforced';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'unique index OK (key=%)', probe_key;
  END;
END `$do`$;
ROLLBACK;
SELECT 'trace_rows_after_rollback=' || count(*)
FROM push_broadcasts WHERE idempotency_key = '$probeKey';
SELECT 'pending_or_sending_now=' || count(*)
FROM push_broadcasts WHERE status IN ('pending','sending');
"@

    $probe = Invoke-Psql -Sql $probeSql

    if ($probe.ExitCode -eq 0 -and $probe.Text.Contains('unique index OK')) {
        Write-Ok "индекс работает: unique index OK"
    } else {
        Write-Bad "unique-индекс не подтверждён (exit $($probe.ExitCode))"
        Write-Host $probe.Text
    }

    if ($probe.Text.Contains('trace_rows_after_rollback=0')) {
        Write-Ok "откат чистый: trace_rows_after_rollback=0"
    } else {
        Write-Bad "после ROLLBACK осталась строка пробы $probeKey — проверить вручную и удалить"
        Write-Host $probe.Text
    }

    if ($probe.Text.Contains('pending_or_sending_now=0')) {
        Write-Ok "нет рассылок в очереди: pending_or_sending=0"
    } else {
        Write-Bad "есть pending/sending рассылки — cron доставит их людям, разобрать до релиза"
    }
}

$remoteScript = '/app/_notif_smoke.mjs'
if (-not $SkipSmoke) {
    Write-Section "3. API-smoke на одноразовой БД $SmokeDb"

    $localScript = Join-Path $PSScriptRoot '..\_notif_smoke.mjs'
    if (-not (Test-Path -LiteralPath $localScript)) {
        Write-Bad "не найден $localScript"
    } else {
        $localScript = (Resolve-Path -LiteralPath $localScript).Path
        $localMd5 = (Get-FileHash -LiteralPath $localScript -Algorithm MD5).Hash.ToLower()
        $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($localScript))

        if ($base64.Length -gt 24000) {
            Write-Bad "файл слишком велик для base64-аргумента ($($base64.Length) символов); используйте kubectl cp"
        } else {
            try {
                $stage = Invoke-Kubectl -KubeArgs @(
                    'exec', $pod, '--', 'sh', '-c',
                    "printf %s $base64 | base64 -d > $remoteScript"
                )
                if ($stage.ExitCode -ne 0) {
                    Write-Bad "не удалось положить smoke-скрипт в под"
                    Write-Host $stage.Text
                } else {
                    $remoteMd5 = (
                        Invoke-Kubectl -KubeArgs @(
                            'exec', $pod, '--', 'sh', '-c', "md5sum $remoteScript | cut -d' ' -f1"
                        )
                    ).Text.Trim()

                    if ($remoteMd5 -eq $localMd5) {
                        Write-Ok "smoke-скрипт доставлен (md5 $remoteMd5)"
                    } else {
                        Write-Bad "md5 не совпал: локально $localMd5, в поде '$remoteMd5'"
                    }

                    $run = Invoke-Kubectl -KubeArgs @(
                        'exec', $pod, '--', 'sh', '-c',
                        "cd /app && DB_NAME=$SmokeDb timeout -s KILL $TimeoutSec node _notif_smoke.mjs"
                    )

                    $passed = $run.Text -match '(\d+)/(\d+) checks passed'
                    if ($passed -and $Matches[1] -eq $Matches[2] -and $run.ExitCode -eq 0) {
                        Write-Ok "smoke: $($Matches[1])/$($Matches[2]) проверок, exit 0"
                    } else {
                        Write-Bad "smoke провален (exit $($run.ExitCode))"
                        Write-Host (($run.Output | Select-Object -Last 40) -join "`n")
                    }
                }
            } finally {
                $null = Invoke-Kubectl -KubeArgs @('exec', $pod, '--', 'sh', '-c', "rm -f $remoteScript")
                $leftoverFile = (
                    Invoke-Kubectl -KubeArgs @('exec', $pod, '--', 'sh', '-c', "test -e $remoteScript && echo present || echo absent")
                ).Text.Trim()
                if ($leftoverFile -eq 'absent') {
                    Write-Ok "smoke-скрипт удалён из пода"
                } else {
                    Write-Bad "smoke-скрипт остался в поде: $remoteScript"
                }
            }
        }
    }
}

if (-not $SkipSmoke) {
    Write-Section "4. Чистота: одноразовая БД"

    $leftoverSql = @"
SELECT 'leftover=' || count(*) FROM pg_database WHERE datname LIKE 'webplant_notif_smoke%';
"@
    $leftover = Invoke-Psql -Sql $leftoverSql
    if ($leftover.Text.Contains('leftover=0')) {
        Write-Ok "одноразовых БД не осталось"
    } else {
        Write-Bad "осталась БД webplant_notif_smoke* — удалить: dropdb --if-exists --force"
        Write-Host $leftover.Text
    }
}

Write-Section "Итог"

if ($script:Failures.Count -eq 0) {
    Write-Host "Все проверки пройдены." -ForegroundColor Green
    exit 0
}

Write-Host "Провалено проверок: $($script:Failures.Count)" -ForegroundColor Red
$script:Failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
exit 1
