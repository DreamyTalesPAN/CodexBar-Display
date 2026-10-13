# Fail when a bundled Windows binary needs the Visual C++ Redistributable.
# Fresh Windows installs do not have VCRUNTIME140*.dll, so such a binary does
# not start there (issue #501). The Rust binaries link the C runtime statically.
$ErrorActionPreference = 'Stop'
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath
$dumpbin = Get-ChildItem "$vs\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe" | Select-Object -Last 1
if (-not $dumpbin) { throw 'dumpbin.exe not found' }
$exes = @(Get-Item windows/src-tauri/target/release/VibeTVControlCenter.exe) + @(Get-ChildItem windows/src-tauri/binaries -Filter *.exe)
$needsRuntime = foreach ($exe in $exes) {
  $deps = & $dumpbin.FullName /nologo /dependents $exe.FullName
  if ($LASTEXITCODE -ne 0) { throw "dumpbin failed for $($exe.Name)" }
  if ($deps -match '^\s*(vcruntime|msvcp)\S*\.dll\s*$') { $exe.Name }
}
if ($needsRuntime) { throw "needs the Visual C++ Redistributable: $($needsRuntime -join ', ')" }
Write-Host "no Visual C++ runtime imports: $($exes.Name -join ', ')"
