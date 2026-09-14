$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('dsh-install-test-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $root 'DSH source with spaces'
$homeDirectory = Join-Path $root 'DSH home'
$launcher = Join-Path $root 'Launcher with spaces'
try {
    foreach ($folder in @((Join-Path $repo 'apps\cli\lib'), (Join-Path $homeDirectory 'profiles\web'), $launcher)) {
        [void](New-Item -ItemType Directory -Path $folder -Force)
    }
    [IO.File]::WriteAllText((Join-Path $repo 'apps\cli\lib\bin.js'), '')
    $profileFile = Join-Path $homeDirectory 'profiles\web\package.json'
    [IO.File]::WriteAllText($profileFile, '{"dsh":{"profile":{"bundles":[]}},"keep":42}')
    foreach ($name in @('Install-Launcher.ps1','Launch-DSH.vbs','check-deps.mjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $launcher $name) }
    [void](New-Item -ItemType Junction -Path (Join-Path $launcher 'node_modules') -Target (Join-Path $PSScriptRoot 'node_modules'))
    $before = [IO.File]::ReadAllText($profileFile)
    & (Join-Path $launcher 'Install-Launcher.ps1') -RepositoryPath $repo -DshHome $homeDirectory -ShortcutDirectory $root -SkipDependencyInstall
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $launcher 'launcher-config.json') | ConvertFrom-Json
    if ($config.repository -ne $repo -or $config.home -ne $homeDirectory) { throw 'Path round-trip failed' }
    if ($before -cne [IO.File]::ReadAllText($profileFile)) { throw 'Installer changed the DSH profile' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'DSH Launcher.lnk'))) { throw 'Shortcut missing' }
    & (Join-Path $launcher 'Install-Launcher.ps1') -RepositoryPath $repo -DshHome $homeDirectory -NoShortcut -SkipDependencyInstall
    if (@(Get-ChildItem -LiteralPath $launcher -Directory -Filter 'install-backup-*').Count -ne 1) { throw 'Reinstall did not back up the config' }
    Write-Output 'PASS: install paths, shortcut, reinstall backup, DSH profile preserved'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path' }
    $junction = Join-Path $launcher 'node_modules'
    if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction) }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
