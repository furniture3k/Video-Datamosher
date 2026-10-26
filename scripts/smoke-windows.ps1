# Installs the Windows installers built by the release workflow (the .msi, then the -setup.exe) and
# runs the desktop app's smoke test (MOSHPIT_SMOKE_TEST, see src-tauri/src/smoke.rs) on each install.
#
#   pwsh scripts/smoke-windows.ps1 <folder with the installers>
param([string]$Dir = '.')
$ErrorActionPreference = 'Stop'
$failed = 0
$env:MOSHPIT_SMOKE_TEST = if ($env:SMOKE) { $env:SMOKE } else { 'network' }

function Test-App([string]$Name, [string]$Exe) {
  Write-Host "== $Name ($Exe)"
  if (-not (Test-Path $Exe)) { Write-Host "not installed"; $script:failed++; return }
  # the app is a GUI program: its report comes back through redirected output
  $p = Start-Process -FilePath $Exe -RedirectStandardOutput smoke.out -RedirectStandardError smoke.err -PassThru
  if (-not $p.WaitForExit(200000)) { $p.Kill(); Write-Host "did not finish" }
  Get-Content smoke.out, smoke.err
  Write-Host "== ${Name}: exit $($p.ExitCode)"
  if ($p.ExitCode -ne 0) { $script:failed++ }
}

$msi = Get-ChildItem $Dir -Recurse -Filter *.msi | Select-Object -First 1
Start-Process msiexec.exe -ArgumentList "/i `"$($msi.FullName)`" /qn /norestart /l*v msi.log" -Wait
Test-App 'MSI install' "$env:ProgramFiles\moshpit\moshpit.exe"

$setup = Get-ChildItem $Dir -Recurse -Filter *-setup.exe | Select-Object -First 1
Start-Process $setup.FullName -ArgumentList '/S' -Wait
Test-App 'setup.exe install' "$env:LOCALAPPDATA\moshpit\moshpit.exe"

exit $failed
