# Download the hash-pinned Win-CodexBar console CLI (release zip).
# Never run the upstream GUI/installer or build upstream.
#
# Temporarily pinned to the VibeTV fork (marcus7989/Win-CodexBar, branch
# vibetv) instead of nesszer/Win-CodexBar: it carries the Windows Claude
# /usage probe fixes the Companion needs (probe retries, cross-process lock,
# shared probe result) on top of upstream v0.60.3. Switch back to the
# upstream URL once those patches land there.
param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
# Version the CLI reports with --version (unchanged from upstream in the fork).
$version = '0.60.3'
$releaseTag = 'v0.60.3-vibetv.1'
$releaseRepo = 'marcus7989/Win-CodexBar'
$sha256 = 'aead02c2376a278b62620b39db2f1db043faf7cce69495dc6e47b90691b685ef'
New-Item -ItemType Directory -Force $Destination | Out-Null
$zip = Join-Path $Destination "CodexBarCLI-$releaseTag-windows-x64.zip"
Invoke-WebRequest "https://github.com/$releaseRepo/releases/download/$releaseTag/CodexBarCLI-$releaseTag-windows-x64.zip" -OutFile $zip
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) { throw 'Win-CodexBar CLI checksum mismatch' }
$payload = Join-Path $Destination 'payload'
Expand-Archive $zip -DestinationPath $payload -Force
$cli = @(Get-ChildItem $payload -Recurse -Filter codexbar-cli.exe)
if ($cli.Count -ne 1) { throw 'Expected exactly one console CLI in the pinned zip' }
# This release is unsigned; authenticity is the release SHA-256 above.
"CODEXBAR_CONTRACT_BIN=$($cli[0].FullName)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
"CODEXBAR_CONTRACT_VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
