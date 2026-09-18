#!/usr/bin/env pwsh
# Authenticode signing for one Windows artifact through Azure Artifact Signing
# (the service formerly called Trusted Signing).
#
# Tauri calls this once per file it bundles, substituting %1 with the path, so
# the script must stay single-file and must fail loudly: a silently unsigned
# installer would reach customers with the SmartScreen warning we are paying to
# avoid.
#
# Microsoft is renaming the CLI surface from "trusted-signing" to
# "artifact-signing" while both spellings are still in the wild, so try the new
# name first and fall back to the old one instead of pinning a name that can
# disappear under us.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
    throw "sign-windows-artifact: file not found: $Path"
}

foreach ($name in @('VIBETV_SIGNING_ENDPOINT', 'VIBETV_SIGNING_ACCOUNT', 'VIBETV_SIGNING_PROFILE')) {
    if (-not (Get-Item -Path "env:$name" -ErrorAction SilentlyContinue).Value) {
        throw "sign-windows-artifact: $name is required."
    }
}

$endpoint = $env:VIBETV_SIGNING_ENDPOINT
$account = $env:VIBETV_SIGNING_ACCOUNT
$profileName = $env:VIBETV_SIGNING_PROFILE
# Azure Artifact Signing issues certificates that expire within hours. Without
# an RFC 3161 timestamp the signature dies with them, so this is not optional.
$timestampUrl = if ($env:VIBETV_SIGNING_TIMESTAMP_URL) { $env:VIBETV_SIGNING_TIMESTAMP_URL } else { 'http://timestamp.acs.microsoft.com' }

function Invoke-SignCli {
    param([string]$Subcommand, [string]$FlagPrefix)

    & sign code $Subcommand `
        "--$FlagPrefix-endpoint" $endpoint `
        "--$FlagPrefix-account" $account `
        "--$FlagPrefix-certificate-profile" $profileName `
        --timestamp-url $timestampUrl `
        --verbosity information `
        $Path 2>&1
}

$output = Invoke-SignCli -Subcommand 'artifact-signing' -FlagPrefix 'artifact-signing'
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    $text = ($output | Out-String)
    # Only an unrecognised subcommand justifies a second attempt; a real signing
    # failure must surface instead of being retried under a different name.
    if ($text -match "(?i)unrecognized command|'artifact-signing' was not matched|Required command was not provided") {
        Write-Host "sign-windows-artifact: 'artifact-signing' unavailable, falling back to 'trusted-signing'."
        $output = Invoke-SignCli -Subcommand 'trusted-signing' -FlagPrefix 'trusted-signing'
        $exitCode = $LASTEXITCODE
    }
}

$output | ForEach-Object { Write-Host $_ }

if ($exitCode -ne 0) {
    throw "sign-windows-artifact: signing failed for $Path (exit $exitCode)."
}

Write-Host "sign-windows-artifact: signed $Path"
