# Download the hash-pinned upstream Win-CodexBar console CLI (release zip).
# Never run the upstream GUI/installer or build upstream.
param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$version = '0.56.8'
$sha256 = '9c547e004f219d4e226ef557bc1cdae790cae6534aa013a895642585dd10e2be'
New-Item -ItemType Directory -Force $Destination | Out-Null
$zip = Join-Path $Destination "CodexBarCLI-v$version-windows-x64.zip"
Invoke-WebRequest "https://github.com/nesszer/Win-CodexBar/releases/download/v$version/CodexBarCLI-v$version-windows-x64.zip" -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) { throw 'Win-CodexBar CLI checksum mismatch' }
$payload = Join-Path $Destination 'payload'
Expand-Archive $zip -DestinationPath $payload -Force
$cli = @(Get-ChildItem $payload -Recurse -Filter codexbar-cli.exe)
if ($cli.Count -ne 1) { throw 'Expected exactly one console CLI in the pinned zip' }
# This upstream release is unsigned; authenticity is the release SHA-256 above.
"CODEXBAR_CONTRACT_BIN=$($cli[0].FullName)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
"CODEXBAR_CONTRACT_VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
