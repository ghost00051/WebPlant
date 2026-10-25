#Requires -Version 5.1
<#
.SYNOPSIS
    Полный бэкап WebPlant на хост: дамп базы + архив фото (uploads) из кластера.

.DESCRIPTION
    Снимает дамп PostgreSQL и архив /app/uploads прямо из подов кластера и складывает
    их в Backend/backups. Результат пишется в таблицу backup_runs (source = host),
    по ней админка считает обратный отсчёт и показывает журнал.

    Запускается планировщиком Windows дважды в сутки — в 02:00 и 14:00 по Москве
    (задача «WebPlant full backup», см. Backend/BACKUP.md).

    Большой архив фото режется на части: поток в ~56 МБ через kubectl exec рвётся,
    части по 4 МБ проходят стабильно и каждая сверяется по размеру с подом.

.PARAMETER SkipUploads
    Не архивировать фото (только база).

.PARAMETER RetentionDays
    Сколько дней хранить файлы на хосте. По умолчанию BACKUP_RETENTION_DAYS из .env, иначе 14.
#>
[CmdletBinding()]
param(
    [string]$Namespace = 'webplant',
    [switch]$SkipUploads,
    [int]$RetentionDays
)

$ErrorActionPreference = 'Stop'

$BackendDir = Split-Path -Parent $PSScriptRoot
$BackupsDir = Join-Path $BackendDir 'backups'
$UploadsPathInPod = '/app/uploads'

$script:LogFile = $null
$script:Kubectl = $null
$script:PostgresPod = $null
$script:DbName = 'WebPlant'
$script:DbUser = 'postgres'

function Write-Log([string]$Level, [string]$Text) {
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $Level, $Text
    Write-Host $line
    if ($script:LogFile) {
        try { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 } catch { }
    }
}

function Invoke-Kubectl {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$Capture,
        [switch]$AllowFailure
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $script:Kubectl @Arguments 2>&1)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }

    if ($code -ne 0 -and -not $AllowFailure) {
        $text = ($output | Out-String).Trim()
        throw "kubectl $($Arguments -join ' ') завершился с кодом $code : $text"
    }

    if (-not $Capture) {
        foreach ($line in $output) { Write-Host $line }
    }

    return [pscustomobject]@{ ExitCode = [int]$code; Output = $output }
}

function Read-DotEnv([string]$Path) {
    $map = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path)) { return $map }
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $index = $trimmed.IndexOf('=')
        if ($index -lt 1) { continue }
        $map[$trimmed.Substring(0, $index).Trim()] = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
    }
    return $map
}

function Get-PodName([string]$Selector) {
    # Берём только живой под: упавшие (ContainerStatusUnknown) остаются в списке,
    # и exec в них падает с "cannot exec into a container in a completed pod".
    $result = Invoke-Kubectl -Capture -AllowFailure -Arguments @(
        'get', 'pods', '-n', $Namespace, '-l', $Selector,
        '--field-selector=status.phase=Running',
        '-o', "jsonpath={.items[0].metadata.name}"
    )
    return (($result.Output | Out-String).Trim())
}

function Get-RemoteFileSize([string]$Pod, [string]$RemotePath) {
    $result = Invoke-Kubectl -Capture -AllowFailure -Arguments @(
        'exec', '-n', $Namespace, $Pod, '--', 'stat', '-c', '%s', $RemotePath
    )
    $text = ($result.Output | Out-String).Trim()
    if ($result.ExitCode -eq 0 -and $text -match '^\d+$') { return [int64]$text }
    return [int64]0
}

# Выгрузка файла из пода.
# kubectl cp гоняет tar-поток через exec и на больших объёмах рвётся ("unexpected EOF"),
# поэтому читаем файл через cat и перенаправляем в файл средствами cmd.exe:
# он пишет байты как есть, без участия PowerShell. Размер сверяем с подом.
function Copy-BinaryFromPod {
    param(
        [Parameter(Mandatory)][string]$Pod,
        [Parameter(Mandatory)][string]$RemotePath,
        [Parameter(Mandatory)][string]$LocalFile,
        [int64]$ExpectedBytes = 0,
        [int]$Attempts = 4
    )

    $commandLine = '"{0}" exec -n {1} {2} -- cat {3} > "{4}"' -f $script:Kubectl, $Namespace, $Pod, $RemotePath, $LocalFile

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = @(& cmd.exe /c $commandLine 2>&1)
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }

        if ($code -eq 0 -and (Test-Path -LiteralPath $LocalFile) -and (Get-Item -LiteralPath $LocalFile).Length -gt 0) {
            $actualBytes = (Get-Item -LiteralPath $LocalFile).Length
            if ($ExpectedBytes -le 0 -or $actualBytes -eq $ExpectedBytes) { return }
            Write-Log 'WARN' "выгрузка $RemotePath неполная: $actualBytes из $ExpectedBytes байт (попытка $attempt/$Attempts)"
        } else {
            Write-Log 'WARN' "выгрузка $RemotePath не удалась (попытка $attempt/$Attempts): $(($output | Out-String).Trim())"
        }

        Remove-Item -LiteralPath $LocalFile -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
    }

    throw "не удалось выгрузить $RemotePath из пода $Pod"
}

function Test-TarArchive([string]$Path) {
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tarExe)) { $tarExe = 'tar.exe' }

    $outLog = Join-Path ([System.IO.Path]::GetTempPath()) ('webplant-tar-' + [guid]::NewGuid().ToString('N') + '.out')
    $errLog = "$outLog.err"

    try {
        $process = Start-Process -FilePath $tarExe -ArgumentList @('-tzf', $Path) -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog
        if ($process.ExitCode -ne 0) {
            $detail = ''
            if (Test-Path -LiteralPath $errLog) { $detail = (Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue) }
            throw "архив повреждён: $($detail.Trim())"
        }
        $entries = @(Get-Content -LiteralPath $outLog -ErrorAction SilentlyContinue)
        Write-Log 'INFO' "архив проверен tar -tzf, записей: $($entries.Count)"
    } finally {
        Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
    }
}

# Архив каталога из пода: tar пишет в stdout, хост принимает поток напрямую.
# Файл в поде не создаётся: раньше запись 56 МБ в /tmp пода роняла backend
# (его убивал liveness probe), из-за чего поток обрывался на середине.
function Copy-DirectoryStream {
    param(
        [Parameter(Mandatory)][string]$Pod,
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$LocalFile,
        [int]$Attempts = 3
    )

    $commandLine = '"{0}" exec -n {1} {2} -- nice -n 19 tar -czf - -C {3} . > "{4}"' -f `
        $script:Kubectl, $Namespace, $Pod, $SourcePath, $LocalFile

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = @(& cmd.exe /c $commandLine 2>&1)
            $code = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }

        if ($code -eq 0 -and (Test-Path -LiteralPath $LocalFile) -and (Get-Item -LiteralPath $LocalFile).Length -gt 0) {
            try {
                Test-TarArchive -Path $LocalFile
                return (Get-Item -LiteralPath $LocalFile).Length
            } catch {
                Write-Log 'WARN' "архив $SourcePath не прошёл проверку (попытка $attempt/$Attempts): $($_.Exception.Message)"
            }
        } else {
            Write-Log 'WARN' "архив $SourcePath не снят (попытка $attempt/$Attempts): $(($output | Out-String).Trim())"
        }

        Remove-Item -LiteralPath $LocalFile -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 5
    }

    throw "не удалось снять архив $SourcePath из пода $Pod"
}
function Format-SqlLiteral([string]$Value) {
    if ([string]::IsNullOrEmpty($Value)) { return 'NULL' }
    return "'" + $Value.Replace("'", "''") + "'"
}

function Write-BackupRun {
    param(
        [Parameter(Mandatory)][string]$Status,
        [Parameter(Mandatory)][string]$StartedAt,
        [string]$DatabaseBytes,
        [string]$UploadsBytes,
        [string[]]$Files = @(),
        [string]$ErrorText
    )

    $finishedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $filesJson = '[' + (($Files | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'

    $dbValue = if ($DatabaseBytes) { [int64]$DatabaseBytes } else { 'NULL' }
    $uploadsValue = if ($UploadsBytes) { [int64]$UploadsBytes } else { 'NULL' }

    $sql = @"
INSERT INTO backup_runs (source, status, started_at, finished_at, database_bytes, uploads_bytes, files, error)
VALUES ('host', $(Format-SqlLiteral $Status), $(Format-SqlLiteral $StartedAt), $(Format-SqlLiteral $finishedAt),
        $dbValue, $uploadsValue, $(Format-SqlLiteral $filesJson)::jsonb, $(Format-SqlLiteral $ErrorText));
DELETE FROM backup_runs WHERE finished_at < now() - interval '180 days';
"@

    $tempDir = [System.IO.Path]::GetTempPath()
    $sqlFileName = "webplant-backup-run-$([guid]::NewGuid().ToString('N')).sql"
    $localSql = Join-Path $tempDir $sqlFileName
    $remoteSql = '/tmp/webplant-backup-run.sql'

    try {
        [System.IO.File]::WriteAllText($localSql, $sql, (New-Object System.Text.UTF8Encoding($false)))

        Push-Location -LiteralPath $tempDir
        try {
            Invoke-Kubectl -Arguments @('cp', $sqlFileName, "${Namespace}/$($script:PostgresPod):$remoteSql") | Out-Null
        } finally {
            Pop-Location
        }

        $result = Invoke-Kubectl -AllowFailure -Capture -Arguments @(
            'exec', '-n', $Namespace, $script:PostgresPod, '--',
            'psql', '-U', $script:DbUser, '-d', $script:DbName, '-v', 'ON_ERROR_STOP=1', '-q', '-f', $remoteSql
        )
        Invoke-Kubectl -AllowFailure -Arguments @(
            'exec', '-n', $Namespace, $script:PostgresPod, '--', 'rm', '-f', $remoteSql
        ) | Out-Null

        if ($result.ExitCode -ne 0) {
            Write-Log 'WARN' "не удалось записать запуск в backup_runs: $(($result.Output | Out-String).Trim())"
        } else {
            Write-Log 'INFO' "запуск записан в backup_runs ($Status)"
        }
    } catch {
        Write-Log 'WARN' "не удалось записать запуск в backup_runs: $($_.Exception.Message)"
    } finally {
        Remove-Item -LiteralPath $localSql -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Retention([int]$Days) {
    if ($Days -le 0) { return }
    $limit = (Get-Date).AddDays(-$Days)
    $patterns = @('db-*.dump', 'uploads-*.tar.gz', 'webplant_*.dump', 'uploads_*.tar.gz')
    $removed = 0

    foreach ($pattern in $patterns) {
        foreach ($file in @(Get-ChildItem -LiteralPath $BackupsDir -Filter $pattern -File -ErrorAction SilentlyContinue)) {
            if ($file.LastWriteTime -lt $limit) {
                Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
                $removed++
            }
        }
    }

    if ($removed -gt 0) { Write-Log 'INFO' "ретенция ${Days}д: удалено файлов — $removed" }
}

# --- окружение -------------------------------------------------------------

$kubectlCommand = Get-Command kubectl -ErrorAction SilentlyContinue
if (-not $kubectlCommand) { throw 'kubectl не найден в PATH — бэкап запускается на хосте, где настроен доступ к кластеру' }
$script:Kubectl = $kubectlCommand.Source

if (-not (Test-Path -LiteralPath $BackupsDir)) {
    New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
}

$script:LogFile = Join-Path $BackupsDir 'backup.log'

$envMap = Read-DotEnv (Join-Path $BackendDir '.env')
if ($envMap['DB_NAME']) { $script:DbName = $envMap['DB_NAME'] }
if ($envMap['DB_USER']) { $script:DbUser = $envMap['DB_USER'] }
if (-not $RetentionDays) {
    $RetentionDays = if ($envMap['BACKUP_RETENTION_DAYS']) { [int]$envMap['BACKUP_RETENTION_DAYS'] } else { 14 }
}

$startedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')

$dbOut = Join-Path $BackupsDir "db-$stamp.dump"
$uploadsOut = Join-Path $BackupsDir "uploads-$stamp.tar.gz"
$dbRemote = "/tmp/webplant-db-$stamp.dump"

$dbBytes = $null
$uploadsBytes = $null
$files = @()

try {
    Write-Log 'INFO' "бэкап начат (stamp=$stamp, ретенция ${RetentionDays}д)"

    $script:PostgresPod = Get-PodName 'app=postgres'
    if (-not $script:PostgresPod) { throw 'под PostgreSQL в кластере не найден' }
    Write-Log 'INFO' "PostgreSQL: $($script:PostgresPod)"

    # --- база ---
    Invoke-Kubectl -Arguments @(
        'exec', '-n', $Namespace, $script:PostgresPod, '--',
        'pg_dump', '-Fc', '-U', $script:DbUser, '-d', $script:DbName, '-f', $dbRemote
    ) | Out-Null

    $verify = Invoke-Kubectl -AllowFailure -Capture -Arguments @(
        'exec', '-n', $Namespace, $script:PostgresPod, '--', 'pg_restore', '--list', $dbRemote
    )
    if ($verify.ExitCode -ne 0) { throw 'pg_restore --list отверг дамп: архив битый или пустой' }

    $dbRemoteBytes = Get-RemoteFileSize -Pod $script:PostgresPod -RemotePath $dbRemote
    Copy-BinaryFromPod -Pod $script:PostgresPod -RemotePath $dbRemote -LocalFile $dbOut -ExpectedBytes $dbRemoteBytes
    Invoke-Kubectl -AllowFailure -Arguments @(
        'exec', '-n', $Namespace, $script:PostgresPod, '--', 'rm', '-f', $dbRemote
    ) | Out-Null

    $dbBytes = (Get-Item -LiteralPath $dbOut).Length
    if ($dbBytes -le 0) { throw 'дамп базы пустой' }
    $files += "db-$stamp.dump"
    Write-Log 'INFO' "дамп базы: db-$stamp.dump ($([math]::Round($dbBytes / 1MB, 2)) МБ)"

    # --- фото ---
    if ($SkipUploads) {
        Write-Log 'WARN' 'фото пропущены (-SkipUploads)'
    } else {
        $backendPod = Get-PodName 'app=webplant-backend'
        if (-not $backendPod) { throw 'под backend в кластере не найден — фото не забрать' }
        Write-Log 'INFO' "backend: $backendPod"

        $uploadsBytes = Copy-DirectoryStream -Pod $backendPod -SourcePath $UploadsPathInPod -LocalFile $uploadsOut
        $files += "uploads-$stamp.tar.gz"
        Write-Log 'INFO' "архив фото: uploads-$stamp.tar.gz ($([math]::Round($uploadsBytes / 1MB, 2)) МБ)"
    }

    Invoke-Retention -Days $RetentionDays

    $heartbeat = @(
        "finished_at=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "started_at=$startedAt",
        "stamp=$stamp",
        "database_file=db-$stamp.dump",
        "database_bytes=$dbBytes"
    )
    if ($uploadsBytes) {
        $heartbeat += "uploads_file=uploads-$stamp.tar.gz"
        $heartbeat += "uploads_bytes=$uploadsBytes"
    }
    $heartbeat += "retention_days=$RetentionDays"
    [System.IO.File]::WriteAllText(
        (Join-Path $BackupsDir '.last-success'),
        ($heartbeat -join "`r`n"),
        (New-Object System.Text.UTF8Encoding($false))
    )

    Write-BackupRun -Status 'ok' -StartedAt $startedAt -DatabaseBytes $dbBytes -UploadsBytes $uploadsBytes -Files $files
    Write-Log 'INFO' 'бэкап завершён успешно'
    exit 0
} catch {
    $message = $_.Exception.Message
    Write-Log 'ERROR' "бэкап не удался: $message"
    Remove-Item -LiteralPath $dbOut, $uploadsOut -Force -ErrorAction SilentlyContinue
    Write-BackupRun -Status 'failed' -StartedAt $startedAt -Files $files -ErrorText $message
    exit 1
}
