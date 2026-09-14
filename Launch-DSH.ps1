param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$launcherDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$endpointFile = Join-Path $launcherDirectory 'launcher-endpoint.json'
$mutex = New-Object System.Threading.Mutex($false, 'Local\DSH-Plugin-Launcher-Window')
$locked = $false
function Get-LauncherUrl {
    if (-not (Test-Path -LiteralPath $endpointFile)) { return $null }
    try {
        $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $endpointFile | ConvertFrom-Json
        $uri = [Uri]$record.url
        if ($uri.Host -ne '127.0.0.1' -or $uri.Scheme -ne 'http') { return $null }
        $ping = Invoke-RestMethod -Uri ($record.url.Replace('/?','/ping?')) -TimeoutSec 2
        if ($ping.kind -eq 'dsh-plugin-launcher' -and $ping.pid -eq $record.pid) { return $record.url }
    } catch {}
    return $null
}
try {
    try { $locked = $mutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Launcher is busy. Please try again shortly.' }
    $url = Get-LauncherUrl
    if ($url) {
        $status = Invoke-RestMethod -Uri ($url.Replace('/?','/state?')) -TimeoutSec 3
        if ($status.phase -in @('ready','started','error')) {
            [void](Invoke-RestMethod -Method Post -Uri ($url.Replace('/?','/scan?')) -ContentType 'application/json' -Body '{}' -TimeoutSec 3)
        }
    }
    if (-not $url) {
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $node) { throw 'Node.js runtime was not found.' }
        $worker = Join-Path $launcherDirectory 'server.mjs'
        $process = Start-Process -FilePath $node.Source -ArgumentList @(('"'+$worker+'"')) -WorkingDirectory $launcherDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $launcherDirectory 'selector.stdout.log') -RedirectStandardError (Join-Path $launcherDirectory 'selector.stderr.log') -PassThru
        for ($i=0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 250
            $url = Get-LauncherUrl
            if ($url) { break }
            if ($process.HasExited) { throw 'Plugin selector exited. See selector.stderr.log.' }
        }
        if (-not $url) { throw 'Plugin selector did not become ready. See selector.stderr.log.' }
    }
    if (-not $NoOpen) {
        $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
        if (Test-Path -LiteralPath $edge) { Start-Process -FilePath $edge -ArgumentList @("--app=$url",'--window-size=1100,820') }
        else { Start-Process $url }
    }
} catch {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.Popup($_.Exception.Message,0,'DeepSeek Harness',16)
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
