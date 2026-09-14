$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Runtime-DSH.ps1') -LibraryOnly
$originalHealth = ${function:Test-DshReady}
$script:events=New-Object System.Collections.Generic.List[string]
function Write-LauncherLog([string]$Message) {}
function Get-DshProcess { $script:events.Add('identity'); return $null }
function Start-Dsh { $script:events.Add('start'); return $false }
function Stop-Dsh { $script:events.Add('stop') }
try { Ensure-DshReady; throw 'Expected failure missing' } catch { if($_.Exception.Message -notlike 'DSH still failed*'){throw} }
if(($script:events -join ',') -ne 'identity,start,stop,start,stop'){throw "Unexpected cleanup order: $script:events"}
$script:events.Clear()
function Get-DshProcess { $script:events.Add('identity'); return @{ProcessId=123} }
function Test-DshReady { $script:events.Add('health'); return $true }
Ensure-DshReady
if(($script:events -join ',') -ne 'identity,health'){throw 'Healthy service identity check missing'}
$script:events.Clear()
function Get-DshProcess { throw 'Port owned by another app' }
try { Ensure-DshReady; throw 'Expected identity error missing' } catch { if($_.Exception.Message -ne 'Port owned by another app'){throw} }
if($script:events.Count -ne 0){throw 'Touched foreign process'}
'PASS: retry limit, final cleanup, identity before reuse, foreign process rejected'
Set-Item -Path Function:\Test-DshReady -Value $originalHealth
$QuickHealth=$true
$OutputLog=$null
$script:healthRequests=0
function Invoke-WebRequest {
    param($Uri,$WebSession,$TimeoutSec,[switch]$UseBasicParsing)
    $script:healthRequests++
    return [pscustomobject]@{StatusCode=200;Content='<script>window.__DSH_BOOT__={"entries":[{"url":"/a.js"}]};</script>';Headers=@{'Content-Type'='text/html'}}
}
if(-not(Test-DshReady)){throw 'Cached runtime readiness failed'}
if($script:healthRequests -ne 1){throw 'Cached runtime repeated asset validation'}
$QuickHealth=$false
if(Test-DshReady){throw 'Uncached runtime accepted HTML as JavaScript'}
'PASS: cached runtime checks live readiness once; uncached runtime validates script responses'
