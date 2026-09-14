param([switch]$NoOpen, [switch]$NoDialog, [switch]$LibraryOnly, [switch]$Restart, [switch]$QuickHealth)
$ErrorActionPreference = 'Stop'
$LauncherDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryPath = $env:DSH_LAUNCHER_REPO
if (-not $LibraryOnly) {
    $configPath = Join-Path $LauncherDirectory 'launcher-config.json'
    if (Test-Path -LiteralPath $configPath) {
        $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
        if (-not $RepositoryPath) { $RepositoryPath = $config.repository }
        if (-not $env:DSH_HOME) { $env:DSH_HOME = $config.home }
    }
    if (-not $RepositoryPath) { throw 'Configure the DSH repository with Install-Launcher.ps1 first.' }
}
$DshUrl = 'http://127.0.0.1:3080'
$ErrorLog = Join-Path $LauncherDirectory 'dsh.stderr.log'
$OutputLog = Join-Path $LauncherDirectory 'dsh.stdout.log'
$LauncherLog = Join-Path $LauncherDirectory 'launcher.log'
$script:HealthError = ''
$script:StartedProcess = $null
$script:LaunchUrl = $DshUrl
$script:WebSession = $null

function Write-LauncherLog([string]$Message) {
    Add-Content -LiteralPath $LauncherLog -Encoding UTF8 -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message)
}

function Test-DshReady {
    try {
        $launchUrl = $DshUrl
        if ($OutputLog -and (Test-Path -LiteralPath $OutputLog)) {
            $startup = Select-String -LiteralPath $OutputLog -Encoding UTF8 -Pattern '^dsh web: (http://127\.0\.0\.1:3080/\?token=[A-Za-z0-9_-]+)\s*$' | Select-Object -Last 1
            if ($startup) { $launchUrl = $startup.Matches[0].Groups[1].Value }
        }
        if ($null -eq $script:WebSession -or $script:LaunchUrl -ne $launchUrl) {
            $script:WebSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        }
        $script:LaunchUrl = $launchUrl
        $response = Invoke-WebRequest -UseBasicParsing -Uri $launchUrl -WebSession $script:WebSession -TimeoutSec 4
        $match = [regex]::Match($response.Content, '(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=\s*(\{.*?\})\s*;?\s*</script>', 'Singleline')
        if (-not $match.Success) { throw 'DSH startup manifest is missing.' }
        $boot = $match.Groups[1].Value | ConvertFrom-Json
        $urls = @(@($boot.entries) + @($boot.batches) | ForEach-Object { if ($_.url) { $_.url } })
        $urls += @([regex]::Matches($response.Content, '<script[^>]+src="([^"]+)"') | ForEach-Object { [System.Net.WebUtility]::HtmlDecode($_.Groups[1].Value) })
        $urls = @($urls | Sort-Object -Unique)
        if ($urls.Count -eq 0) { throw 'DSH startup scripts are missing.' }
        if ($QuickHealth) { $script:HealthError = ''; return $true }
        foreach ($path in $urls) {
            if ($path.StartsWith('./')) { $path = $path.Substring(1) }
            if (-not $path.StartsWith('/') -or $path.StartsWith('//')) { throw "Unexpected script URL: $path" }
            $bundle = Invoke-WebRequest -UseBasicParsing -Uri ($DshUrl + $path) -WebSession $script:WebSession -TimeoutSec 8
            if ($bundle.StatusCode -ne 200 -or $bundle.Headers['Content-Type'] -notmatch 'javascript' -or [string]::IsNullOrWhiteSpace($bundle.Content)) {
                throw "Invalid script response: $path"
            }
        }
        $script:HealthError = ''
        return $true
    } catch {
        $script:HealthError = $_.Exception.Message
        return $false
    }
}

function Get-DshProcess {
    $listeners = @(Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)
    foreach ($ownerId in @($listeners.OwningProcess | Sort-Object -Unique)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId"
        $entry = Join-Path $RepositoryPath 'apps\cli\lib\bin.js'
        if ($process.Name -ne 'node.exe' -or $process.CommandLine -notlike "*$entry*" -or $process.CommandLine -notmatch '\bweb\b') {
            throw "Port 3080 is occupied by another process (PID $ownerId). It was not stopped."
        }
        return $process
    }
    return $null
}

function Stop-Dsh {
    $process = Get-DshProcess
    if ($null -eq $process -and $null -ne $script:StartedProcess) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($script:StartedProcess.Id)" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -notlike "*$(Join-Path $RepositoryPath 'apps\cli\lib\bin.js')*") { throw 'DSH process identity changed.' }
    }
    if ($process) {
        Write-LauncherLog "Stopping DSH PID $($process.ProcessId)."
        & "$env:SystemRoot\System32\taskkill.exe" /PID $process.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) { throw 'Unable to stop DSH.' }
        for ($i=0; $i -lt 20; $i++) {
            if (-not (Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 250
        }
    }
}

function Start-Dsh {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js runtime was not found on PATH.' }
    $nodePath = $node.Source
    foreach ($log in @($ErrorLog,$OutputLog)) { if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log -Destination "$log.previous" -Force } }
    $entry = Join-Path $RepositoryPath 'apps\cli\lib\bin.js'
    if (-not (Test-Path -LiteralPath $entry)) { throw 'DSH build is missing. Rebuild the application before starting.' }
    $supervisor = Join-Path $LauncherDirectory 'Probe-Process.ps1'
    $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$supervisor+'"'),'-NodePath',('"'+$nodePath+'"'),'-Entry',('"'+$entry+'"'),'-RuntimePatch',('"'+(Join-Path $LauncherDirectory 'selected-plugins.yml')+'"'))
    $script:StartedProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $RepositoryPath -RedirectStandardOutput $OutputLog -RedirectStandardError $ErrorLog -WindowStyle Hidden -PassThru
    Write-LauncherLog "Started DSH PID $($script:StartedProcess.Id)."
    $deadline = (Get-Date).AddSeconds(120)
    do {
        if (Test-DshReady) { return $true }
        if ($script:StartedProcess.HasExited) { $script:HealthError = "DSH exited: $($script:HealthError)"; return $false }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Ensure-DshReady {
    $existing = Get-DshProcess
    if ($existing -and (Test-DshReady)) { Write-LauncherLog 'Existing DSH and startup scripts are healthy.'; return }
    if (-not $existing) {
        Write-LauncherLog 'Starting DSH.'
        if (Start-Dsh) { Write-LauncherLog 'DSH ready.'; return }
    }
    Write-LauncherLog "Health check failed: $script:HealthError. Restarting once."
    Stop-Dsh
    if (Start-Dsh) { Write-LauncherLog 'DSH recovered after one restart.'; return }
    Stop-Dsh
    throw "DSH still failed after one restart. $script:HealthError"
}

if ($LibraryOnly) { return }
$mutex = New-Object System.Threading.Mutex($false, 'Local\DSH-Desktop-Launcher-3080')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another DSH runtime launcher is already running. Please wait for it to finish.' }
    if (-not (Test-Path -LiteralPath $RepositoryPath)) { throw "DSH repository is missing: $RepositoryPath" }
    if ($Restart) { Stop-Dsh }
    Ensure-DshReady
    if (-not $NoOpen) {
        $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
        if (Test-Path -LiteralPath $edge) { Start-Process -FilePath $edge -ArgumentList @("--app=$script:LaunchUrl",'--start-maximized') }
        else { Start-Process $script:LaunchUrl }
    }
} catch {
    Write-LauncherLog $_.Exception.Message
    $message = "DSH 启动失败，自动恢复未成功。`r`n$($_.Exception.Message)`r`n`r`n请将以下日志提供给维护人员：`r`n$LauncherLog`r`n$ErrorLog"
    if ($NoDialog) { Write-Error $message -ErrorAction Continue }
    else { $shell = New-Object -ComObject WScript.Shell; [void]$shell.Popup($message,0,'DeepSeek Harness',16) }
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
