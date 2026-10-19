$ErrorActionPreference = 'Continue'
$repo = 'C:\Dev\WebPlant\Backend'
$log = Join-Path $env:TEMP 'pgadmin-tls-finisher.log'
$domain = 'pgadmin.checktheplants.ru'
$targetIp = '91.223.89.222'
$email = 'admin@checktheplants.ru'
$webroot = Join-Path $repo 'certbot\www'
$pending = Join-Path $repo 'nginx\pending\pgadmin-tls.conf'
$active = Join-Path $repo 'nginx\conf.d\pgadmin-tls.conf'
$nameservers = @('ns1.hosting.reg.ru', 'ns2.hosting.reg.ru')

function Log([string]$m) {
    $line = '{0} {1}' -f (Get-Date -Format 'HH:mm:ss'), $m
    Add-Content -Path $log -Value $line -Encoding UTF8
    Write-Host $line
}

function Get-NS-Answer([string]$ns) {
    $r = Resolve-DnsName $domain -Type A -Server $ns -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress }
    return (($r | ForEach-Object { $_.IPAddress }) -join ',')
}

function Test-DnsReady {
    foreach ($ns in $nameservers) {
        $a = Get-NS-Answer $ns
        if ($a -ne $targetIp) { return $false }
    }
    return $true
}

function Test-Cert {
    $out = docker run --rm -v backend_certbot_conf:/etc/letsencrypt --entrypoint sh certbot/certbot -c "test -f /etc/letsencrypt/live/$domain/fullchain.pem && echo YES || echo NO" 2>$null
    return (($out -join ' ') -match 'YES')
}

function Request-Cert {
    $out = docker run --rm -v backend_certbot_conf:/etc/letsencrypt -v "${webroot}:/var/www/certbot" certbot/certbot certonly --webroot -w /var/www/certbot -d $domain --email $email --agree-tos --no-eff-email --non-interactive 2>&1
    Log ('certbot: ' + (($out | Select-Object -Last 3) -join ' | '))
    return (Test-Cert)
}

function Enable-Tls {
    if (Test-Path $active) { Log 'tls config already active'; return $true }
    Copy-Item $pending $active -Force
    Push-Location $repo
    docker compose -f docker-compose.yml build nginx 2>&1 | Out-Null
    docker compose -f docker-compose.yml up -d --no-deps nginx 2>&1 | Out-Null
    Pop-Location
    Start-Sleep -Seconds 6
    $test = (docker exec ctp_nginx nginx -t 2>&1) -join ' '
    if ($test -notmatch 'test is successful') {
        Log ('nginx -t FAILED, rolling back: ' + $test)
        Remove-Item $active -Force -ErrorAction SilentlyContinue
        Push-Location $repo
        docker compose -f docker-compose.yml build nginx 2>&1 | Out-Null
        docker compose -f docker-compose.yml up -d --no-deps nginx 2>&1 | Out-Null
        Pop-Location
        return $false
    }
    $code = & curl.exe -s -o NUL -w '%{http_code}' --resolve "${domain}:443:192.168.0.103" "https://$domain/login" 2>$null
    Log ("https check: code=$code")
    return ($code -eq '200')
}

Log '=== finisher started (waiting for both reg.ru NS) ==='

$dnsDeadline = (Get-Date).AddHours(3)
$lastState = ''
while ((Get-Date) -lt $dnsDeadline) {
    $state = ($nameservers | ForEach-Object { "$_=$(Get-NS-Answer $_)" }) -join ' '
    if ($state -ne $lastState) { Log "dns: $state"; $lastState = $state }
    if (Test-DnsReady) { Log 'dns: both NS return new IP'; break }
    Start-Sleep -Seconds 120
}

if (-not (Test-DnsReady)) {
    Log 'RESULT=FAILED (reg.ru NS did not converge)'
    exit 1
}

Start-Sleep -Seconds 180

$issued = Test-Cert
if ($issued) { Log 'cert already present' }
for ($i = 1; $i -le 4 -and -not $issued; $i++) {
    Log "attempt $i"
    $issued = Request-Cert
    if ($issued) { Log 'certificate issued'; break }
    Start-Sleep -Seconds 900
}
if (-not $issued) {
    Log 'RESULT=FAILED (certificate not issued)'
    exit 1
}

Remove-Item (Join-Path $webroot '.well-known\acme-challenge\le-test.txt') -Force -ErrorAction SilentlyContinue
if (Enable-Tls) { Log 'RESULT=SUCCESS'; exit 0 }
Log 'RESULT=ENABLE_FAILED'
exit 1
