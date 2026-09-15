param(
    [Parameter(Mandatory=$true)][string]$RepositoryPath,
    [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
    [string]$ShortcutDirectory = [Environment]::GetFolderPath('Desktop'),
    [switch]$NoShortcut,
    [switch]$SkipDependencyInstall
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath $RepositoryPath).ProviderPath
$profileHome = (Resolve-Path -LiteralPath $DshHome).ProviderPath
if (-not (Test-Path -LiteralPath (Join-Path $repository 'apps\cli\lib\bin.js'))) {
    throw 'DSH build is missing: apps/cli/lib/bin.js. Build DSH first.'
}
$profileFile = Join-Path $profileHome 'profiles\web\package.json'
if (-not (Test-Path -LiteralPath $profileFile)) { throw 'Initialize the DSH web profile before installing the launcher.' }
$profile = Get-Content -Raw -Encoding UTF8 -LiteralPath $profileFile | ConvertFrom-Json
if ($null -eq $profile.dsh.profile.bundles) { throw 'Invalid DSH web profile: missing dsh.profile.bundles.' }
$node = Get-Command node.exe -ErrorAction Stop
$nodeVersion = & $node.Source --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node.js 22 or newer is required.' }
$endpoint = Join-Path $PSScriptRoot 'launcher-endpoint.json'
if (Test-Path -LiteralPath $endpoint) {
    $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $endpoint | ConvertFrom-Json
    if ($record.pid -and (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)) {
        throw 'Close this launcher before changing its installation settings.'
    }
}
Push-Location -LiteralPath $PSScriptRoot
try {
    if (-not $SkipDependencyInstall) {
        $npm = Get-Command npm.cmd -ErrorAction Stop
        & $npm.Source ci --ignore-scripts --no-audit --no-fund --cache (Join-Path $PSScriptRoot '.npm-cache')
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Check network access and try again.' }
    }
    & $node.Source (Join-Path $PSScriptRoot 'check-deps.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher dependencies are missing. Run npm ci first.' }
} finally { Pop-Location }
$configFile = Join-Path $PSScriptRoot 'launcher-config.json'
if (Test-Path -LiteralPath $configFile) {
    $backupDirectory = Join-Path $PSScriptRoot ('install-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff'))
    [void](New-Item -ItemType Directory -Path $backupDirectory)
    Copy-Item -LiteralPath $configFile -Destination (Join-Path $backupDirectory 'launcher-config.json')
}
$json = @{ repository = $repository; home = $profileHome } | ConvertTo-Json
[IO.File]::WriteAllText($configFile, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
$saved = Get-Content -Raw -Encoding UTF8 -LiteralPath $configFile | ConvertFrom-Json
if ($saved.repository -ne $repository -or $saved.home -ne $profileHome) { throw 'Configuration readback failed.' }
if (-not $NoShortcut) {
    if (-not (Test-Path -LiteralPath $ShortcutDirectory -PathType Container)) { throw 'Shortcut directory does not exist.' }
    $linkFile = Join-Path $ShortcutDirectory 'Sental DSH Preflight.lnk'
    if (Test-Path -LiteralPath $linkFile) {
        Copy-Item -LiteralPath $linkFile -Destination ($linkFile + '.' + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.backup')
    }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkFile)
    $link.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $link.Arguments = '"' + (Join-Path $PSScriptRoot 'Launch-DSH.vbs') + '"'
    $link.WorkingDirectory = $PSScriptRoot
    $link.Description = 'DeepSeek Harness plugin checks and launcher'
    $link.Save()
    $check = $shell.CreateShortcut($linkFile)
    if ($check.Arguments -ne $link.Arguments -or $check.TargetPath -ne $link.TargetPath) { throw 'Shortcut readback failed.' }
    Write-Output "Shortcut created: $linkFile"
}
Write-Output 'Installation complete. Run Launch-DSH.vbs or the Sental DSH Preflight shortcut.'
