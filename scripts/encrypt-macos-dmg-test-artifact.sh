#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly EXPECTED_DMG_NAME="VibeTV-Control-Center.dmg"
readonly OPENSSL="/usr/bin/openssl"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage: encrypt-macos-dmg-test-artifact.sh --dmg PATH --output-dir PATH

Requires CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64 to contain a base64-encoded
PEM X.509 certificate with an RSA public key of at least 3072 bits.
USAGE
  exit 2
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

dmg=""
output_dir=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dmg)
      [[ "$#" -ge 2 ]] || usage
      [[ -z "$dmg" ]] || die "--dmg may only be provided once"
      dmg="$2"
      shift 2
      ;;
    --output-dir)
      [[ "$#" -ge 2 ]] || usage
      [[ -z "$output_dir" ]] || die "--output-dir may only be provided once"
      output_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$dmg" ]] || usage
[[ -n "$output_dir" ]] || usage
[[ -x "$OPENSSL" ]] || die "required OpenSSL executable is unavailable: $OPENSSL"
[[ -n "${CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64:-}" ]] \
  || die "CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64 is required"
[[ -f "$dmg" && -r "$dmg" ]] || die "DMG is not a readable regular file: $dmg"
[[ "$(basename "$dmg")" == "$EXPECTED_DMG_NAME" ]] \
  || die "DMG basename must be exactly $EXPECTED_DMG_NAME"

[[ ! -L "$output_dir" ]] || die "output directory must not be a symbolic link"
if [[ -e "$output_dir" ]]; then
  [[ -d "$output_dir" ]] || die "output path exists and is not a directory: $output_dir"
  [[ -z "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
    || die "output directory must be empty: $output_dir"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/vibetv-dmg-cms.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT HUP INT TERM

decoded_certificate="$tmp_dir/recipient-certificate.decoded"
canonical_certificate="$tmp_dir/recipient-certificate.pem"
certificate_der="$tmp_dir/recipient-certificate.der"
cms_artifact="$tmp_dir/${EXPECTED_DMG_NAME}.cms"

printf '%s' "$CODEX_DMG_RECIPIENT_CERTIFICATE_BASE64" \
  | "$OPENSSL" base64 -d -A >"$decoded_certificate" \
  || die "recipient certificate is not valid base64"

if LC_ALL=C grep -aFq "PRIVATE KEY" "$decoded_certificate"; then
  die "recipient input must not contain a private key"
fi

"$OPENSSL" x509 \
  -in "$decoded_certificate" \
  -inform PEM \
  -out "$canonical_certificate" \
  -outform PEM \
  >/dev/null 2>&1 \
  || die "recipient input is not a valid PEM X.509 certificate"

"$OPENSSL" x509 -in "$canonical_certificate" -checkend 3600 -noout >/dev/null 2>&1 \
  || die "recipient certificate must remain valid for at least one hour"

rsa_details="$tmp_dir/rsa-public-key.txt"
if ! "$OPENSSL" x509 -in "$canonical_certificate" -pubkey -noout \
  | "$OPENSSL" rsa -pubin -text -noout >"$rsa_details" 2>/dev/null; then
  die "recipient certificate must contain an RSA public key"
fi

rsa_bits="$(sed -nE 's/^[[:space:]]*([^:]+[[:space:]])?Public-Key: \(([0-9]+) bit\).*$/\2/p' "$rsa_details" | head -n1)"
[[ "$rsa_bits" =~ ^[0-9]+$ ]] || die "could not determine recipient RSA key size"
(( rsa_bits >= 3072 )) || die "recipient RSA key must be at least 3072 bits"

"$OPENSSL" x509 \
  -in "$canonical_certificate" \
  -outform DER \
  -out "$certificate_der" \
  >/dev/null 2>&1 \
  || die "failed to canonicalize recipient certificate"

"$OPENSSL" cms \
  -encrypt \
  -binary \
  -aes256 \
  -in "$dmg" \
  -outform DER \
  -out "$cms_artifact" \
  -recip "$canonical_certificate" \
  -keyopt rsa_padding_mode:oaep \
  -keyopt rsa_oaep_md:sha256 \
  -keyopt rsa_mgf1_md:sha256 \
  >/dev/null 2>&1 \
  || die "failed to encrypt DMG as CMS EnvelopedData"

"$OPENSSL" cms -cmsout -inform DER -in "$cms_artifact" -noout >/dev/null 2>&1 \
  || die "encrypted CMS artifact failed structural validation"

staged_output="$tmp_dir/output"
mkdir "$staged_output"
mv "$cms_artifact" "$staged_output/${EXPECTED_DMG_NAME}.cms"
printf '%s  %s\n' "$(sha256_file "$dmg")" "$EXPECTED_DMG_NAME" \
  >"$staged_output/${EXPECTED_DMG_NAME}.sha256"
printf '%s  %s\n' \
  "$(sha256_file "$staged_output/${EXPECTED_DMG_NAME}.cms")" \
  "${EXPECTED_DMG_NAME}.cms" \
  >"$staged_output/${EXPECTED_DMG_NAME}.cms.sha256"
printf '%s  %s\n' "$(sha256_file "$certificate_der")" "recipient-certificate.der" \
  >"$staged_output/recipient-certificate.der.sha256"

mkdir -p "$output_dir"
mv "$staged_output"/* "$output_dir"/

printf 'encrypted DMG test artifact created: %s/%s.cms\n' \
  "$output_dir" "$EXPECTED_DMG_NAME"
