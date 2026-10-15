param(
    [Parameter(Mandatory = $true)][string]$FtpHost,
    [Parameter(Mandatory = $true)][string]$FtpUser,
    [Parameter(Mandatory = $true)][string]$FtpPassword,
    [string]$RemoteRoot = '/',
    [string]$LocalRoot = '',
    [switch]$UseSsl,
    [switch]$Verify,
    [switch]$ListOnly,
    [switch]$ListRemote
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($LocalRoot)) {
    $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $LocalRoot = Join-Path $scriptRoot 'Frontend/dist'
}

function New-FtpRequest([string]$Uri, [string]$Method) {
    $request = [System.Net.FtpWebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Credentials = New-Object System.Net.NetworkCredential($FtpUser, $FtpPassword)
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    $request.EnableSsl = [bool]$UseSsl
    return $request
}

function Join-FtpPath([string]$Base, [string]$Part) {
    $left = $Base.TrimEnd('/')
    $right = $Part.TrimStart('/')
    if ([string]::IsNullOrEmpty($right)) { return "$left/" }
    return "$left/$right"
}

function Ensure-FtpDirectory([string]$Path) {
    $segments = $Path.Trim('/').Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
    $current = ''
    foreach ($segment in $segments) {
        $current = "$current/$segment"
        $uri = "ftp://$FtpHost$current"
        try {
            $request = New-FtpRequest $uri ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
            $response = $request.GetResponse()
            $response.Close()
            Write-Host "  MKD $current"
        } catch [System.Net.WebException] {
            $status = $_.Exception.Response.StatusCode
            if ($status -ne [System.Net.FtpStatusCode]::ActionNotTakenFileUnavailable) { throw }
        }
    }
}

if (-not (Test-Path $LocalRoot)) { throw "Local directory not found: $LocalRoot" }

$localFiles = Get-ChildItem -LiteralPath $LocalRoot -Recurse -File

if ($ListRemote) {
    Write-Host "Remote listing of ftp://$FtpHost$RemoteRoot :"
    try {
        $request = New-FtpRequest "ftp://$FtpHost$RemoteRoot" ([System.Net.WebRequestMethods+Ftp]::ListDirectoryDetails)
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $lines = $reader.ReadToEnd()
        $reader.Close()
        $response.Close()
        $lines -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "  $_" }
    } catch {
        Write-Host "  FAIL: $($_.Exception.Message)"
        exit 1
    }
    exit 0
}

if ($ListOnly) {
    Write-Host "Files that would be uploaded to ftp://$FtpHost$RemoteRoot :"
    foreach ($file in $localFiles) {
        $rel = $file.FullName.Substring($LocalRoot.Length).TrimStart('\', '/') -replace '\\', '/'
        Write-Host ("  {0,8} B  {1}" -f $file.Length, $rel)
    }
    Write-Host ''
    Write-Host "Total: $($localFiles.Count) files"
    exit 0
}

Write-Host "Uploading $($localFiles.Count) files from $LocalRoot to ftp://$FtpHost$RemoteRoot"
if ($UseSsl) { Write-Host 'Mode: FTPS (explicit TLS)' }

$uploaded = 0
$failed = @()

foreach ($file in $localFiles) {
    $relative = $file.FullName.Substring($LocalRoot.Length).TrimStart('\', '/')
    $remoteRelative = $relative -replace '\\', '/'
    $remoteDirectory = [System.IO.Path]::GetDirectoryName($remoteRelative) -replace '\\', '/'
    $remotePath = Join-FtpPath $RemoteRoot $remoteRelative

    try {
        if (-not [string]::IsNullOrEmpty($remoteDirectory)) {
            Ensure-FtpDirectory (Join-FtpPath $RemoteRoot $remoteDirectory)
        }

        $request = New-FtpRequest "ftp://$FtpHost$remotePath" ([System.Net.WebRequestMethods+Ftp]::UploadFile)
        $stream = $request.GetRequestStream()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Close()
        }
        $response = $request.GetResponse()
        $response.Close()

        $uploaded++
        Write-Host "  ok  $($file.Length) B  $remoteRelative"
    } catch {
        $failed += "$remoteRelative :: $($_.Exception.Message)"
        Write-Host "  FAIL  $remoteRelative :: $($_.Exception.Message)"
    }
}

Write-Host ''
Write-Host "Uploaded: $uploaded of $($localFiles.Count)"
if ($failed.Count) {
    Write-Host "Failures: $($failed.Count)"
    $failed | ForEach-Object { Write-Host "  $_" }
    exit 1
}

if ($Verify) {
    Write-Host ''
    Write-Host 'Checking key URLs:'
    $urls = @(
        'https://checktheplants.ru/plants.html',
        'https://checktheplants.ru/plants',
        'https://checktheplants.ru/plants/monstera',
        'https://checktheplants.ru/care',
        'https://checktheplants.ru/care/kak-chasto-polivat',
        'https://checktheplants.ru/login',
        'https://checktheplants.ru/robots.txt',
        'https://checktheplants.ru/sitemap.xml'
    )
    foreach ($url in $urls) {
        try {
            $response = Invoke-WebRequest -Uri $url -Method Head -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 20
            Write-Host "  $($response.StatusCode)  $url"
        } catch {
            $code = $_.Exception.Response.StatusCode.value__
            Write-Host "  $code  $url"
        }
    }
}
