# Extract the hash-pinned upstream installer. Never run/install it or build upstream.
param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$version = '0.55.0'
$sha256 = '9e511820b86557263617875b9aac196900eb9318bbb70c3d9eeede1035bf9ab7'
New-Item -ItemType Directory -Force $Destination | Out-Null
$installer = Join-Path $Destination "CodexBar-$version-Setup.exe"
Invoke-WebRequest "https://github.com/nesszer/Win-CodexBar/releases/download/v$version/CodexBar-$version-Setup.exe" -OutFile $installer
if ((Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) { throw 'Win-CodexBar installer checksum mismatch' }
# This exact upstream release is unsigned; authenticity here is the release
# asset SHA-256 above, not an invented Authenticode guarantee.
Write-Host "Pinned installer Authenticode status: $((Get-AuthenticodeSignature $installer).Status)"

# Inno 6.7 archive support. Pinned extractor, used only on the disposable CI host.
$extractorZip = Join-Path $Destination 'innounp.zip'
Invoke-WebRequest 'https://github.com/jrathlev/InnoUnpacker-Windows-GUI/releases/download/oi_2_2_11/innounp-2.zip' -OutFile $extractorZip
if ((Get-FileHash $extractorZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '851772538a041229102ad9964542d49dc00c74002e3091a70469c079ae368f52') { throw 'Extractor checksum mismatch' }
$extractorDir = Join-Path $Destination 'extractor'
Expand-Archive $extractorZip -DestinationPath $extractorDir -Force
$payload = Join-Path $Destination 'payload'
& (Join-Path $extractorDir 'innounp.exe') -x -y "-d$payload" $installer '*codexbar-cli.exe'
if ($LASTEXITCODE -ne 0) { throw "Installer extraction failed: $LASTEXITCODE" }
$cli = @(Get-ChildItem $payload -Recurse -Filter codexbar-cli.exe)
if ($cli.Count -ne 1) { throw 'Expected exactly one console CLI in the pinned installer' }
"CODEXBAR_CONTRACT_BIN=$($cli[0].FullName)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
"CODEXBAR_CONTRACT_VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
