#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENCRYPTOR="${ROOT}/scripts/encrypt-macos-dmg-test-artifact.sh"
OPENSSL="/usr/bin/openssl"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

base64_file() {
  "$OPENSSL" base64 -A -in "$1"
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

assert_hash_file() {
  local metadata="$1"
  local source="$2"
  local recorded_name="$3"
  local expected_line

  expected_line="$(sha256_file "$source")  $recorded_name"
  [[ "$(cat "$metadata")" == "$expected_line" ]] \
    || die "incorrect SHA-256 metadata: $metadata"
}

assert_clean_failed_output() {
  local output_dir="$1"
  if [[ -d "$output_dir" ]]; then
    [[ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
      || die "failed encryption left output files behind: $output_dir"
  fi
}

expect_encrypt_failure() {
  local description="$1"
  local certificate_base64="$2"
  local output_dir="$3"

  if CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64="$certificate_base64" \
    "$ENCRYPTOR" --dmg "$DMG" --output-dir "$output_dir" >/dev/null 2>&1; then
    die "encryption unexpectedly accepted $description"
  fi
  assert_clean_failed_output "$output_dir"
}

[[ -x "$OPENSSL" ]] || die "required OpenSSL executable is unavailable: $OPENSSL"
[[ -x "$ENCRYPTOR" ]] || die "encryptor is missing or not executable: $ENCRYPTOR"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-dmg-cms-test.XXXXXX")"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

DMG="$TMP_ROOT/VibeTV-Control-Center.dmg"
printf 'harmless VibeTV validation fixture\n' >"$DMG"

recipient_key="$TMP_ROOT/recipient-key.pem"
recipient_certificate="$TMP_ROOT/recipient-certificate.pem"
"$OPENSSL" req -new -x509 -newkey rsa:3072 -nodes -sha256 -days 1 \
  -subj "/CN=VibeTV DMG validation recipient" \
  -keyout "$recipient_key" \
  -out "$recipient_certificate" \
  >/dev/null 2>&1

output_dir="$TMP_ROOT/output"
CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64="$(base64_file "$recipient_certificate")" \
  "$ENCRYPTOR" --dmg "$DMG" --output-dir "$output_dir" >/dev/null

expected_files="$(printf '%s\n' \
  "VibeTV-Control-Center.dmg.cms" \
  "VibeTV-Control-Center.dmg.cms.sha256" \
  "VibeTV-Control-Center.dmg.sha256" \
  "recipient-certificate.der.sha256" | LC_ALL=C sort)"
actual_files="$(find "$output_dir" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
[[ "$actual_files" == "$expected_files" ]] \
  || die "output directory contains missing or unexpected files"

cms="$output_dir/VibeTV-Control-Center.dmg.cms"
decrypted="$TMP_ROOT/decrypted.dmg"
"$OPENSSL" cms -decrypt -binary -inform DER \
  -in "$cms" \
  -recip "$recipient_certificate" \
  -inkey "$recipient_key" \
  -out "$decrypted" \
  >/dev/null 2>&1
cmp -s "$DMG" "$decrypted" || die "CMS roundtrip changed the DMG bytes"

assert_hash_file "$output_dir/VibeTV-Control-Center.dmg.sha256" \
  "$DMG" "VibeTV-Control-Center.dmg"
assert_hash_file "$output_dir/VibeTV-Control-Center.dmg.cms.sha256" \
  "$cms" "VibeTV-Control-Center.dmg.cms"

recipient_der="$TMP_ROOT/recipient-certificate.der"
"$OPENSSL" x509 -in "$recipient_certificate" -outform DER -out "$recipient_der"
assert_hash_file "$output_dir/recipient-certificate.der.sha256" \
  "$recipient_der" "recipient-certificate.der"

cms_details="$TMP_ROOT/cms-details.txt"
"$OPENSSL" cms -cmsout -print -inform DER -in "$cms" >"$cms_details"
grep -Fq "rsaesOaep" "$cms_details" || die "CMS does not use RSA-OAEP"
grep -Fq "aes-256-cbc" "$cms_details" || die "CMS does not use AES-256-CBC"
grep -Fq "mgf1" "$cms_details" || die "CMS does not identify MGF1"
sha256_mentions="$(grep -cF "sha256" "$cms_details" || true)"
(( sha256_mentions >= 2 )) \
  || die "CMS does not use SHA-256 for both OAEP and MGF1"

wrong_key="$TMP_ROOT/wrong-key.pem"
wrong_certificate="$TMP_ROOT/wrong-certificate.pem"
"$OPENSSL" req -new -x509 -newkey rsa:3072 -nodes -sha256 -days 1 \
  -subj "/CN=Wrong VibeTV recipient" \
  -keyout "$wrong_key" \
  -out "$wrong_certificate" \
  >/dev/null 2>&1
if "$OPENSSL" cms -decrypt -binary -inform DER \
  -in "$cms" \
  -recip "$wrong_certificate" \
  -inkey "$wrong_key" \
  -out "$TMP_ROOT/wrong-key-output.dmg" \
  >/dev/null 2>&1; then
  die "CMS decrypted with the wrong private key"
fi

malformed_certificate="$TMP_ROOT/malformed-certificate.txt"
printf 'not an X.509 certificate\n' >"$malformed_certificate"
expect_encrypt_failure \
  "a malformed certificate" \
  "$(base64_file "$malformed_certificate")" \
  "$TMP_ROOT/malformed-output"

ec_key="$TMP_ROOT/ec-key.pem"
ec_certificate="$TMP_ROOT/ec-certificate.pem"
"$OPENSSL" ecparam -name prime256v1 -genkey -noout -out "$ec_key"
"$OPENSSL" req -new -x509 -sha256 -days 1 \
  -subj "/CN=Unsupported EC recipient" \
  -key "$ec_key" \
  -out "$ec_certificate" \
  >/dev/null 2>&1
expect_encrypt_failure \
  "an EC certificate" \
  "$(base64_file "$ec_certificate")" \
  "$TMP_ROOT/ec-output"

rsa2048_key="$TMP_ROOT/rsa2048-key.pem"
rsa2048_certificate="$TMP_ROOT/rsa2048-certificate.pem"
"$OPENSSL" req -new -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -subj "/CN=Undersized RSA recipient" \
  -keyout "$rsa2048_key" \
  -out "$rsa2048_certificate" \
  >/dev/null 2>&1
expect_encrypt_failure \
  "a 2048-bit RSA certificate" \
  "$(base64_file "$rsa2048_certificate")" \
  "$TMP_ROOT/rsa2048-output"

expect_encrypt_failure \
  "a private key instead of a certificate" \
  "$(base64_file "$recipient_key")" \
  "$TMP_ROOT/private-key-output"

nonempty_output="$TMP_ROOT/nonempty-output"
mkdir "$nonempty_output"
printf 'stale artifact\n' >"$nonempty_output/stale.txt"
if CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64="$(base64_file "$recipient_certificate")" \
  "$ENCRYPTOR" --dmg "$DMG" --output-dir "$nonempty_output" >/dev/null 2>&1; then
  die "encryption unexpectedly accepted a nonempty output directory"
fi
[[ "$(cat "$nonempty_output/stale.txt")" == "stale artifact" ]] \
  || die "nonempty output directory was modified"
[[ "$(find "$nonempty_output" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" == "1" ]] \
  || die "nonempty output directory gained unexpected files"

printf 'macOS DMG validation artifact test passed\n'
