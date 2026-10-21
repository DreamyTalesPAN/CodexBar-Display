export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  const encoder = new TextEncoder();
  let result = "";
  for (const character of value) {
    const candidate = `${result}${character}`;
    if (encoder.encode(candidate).byteLength > maxBytes) {
      break;
    }
    result = candidate;
  }
  return result.trimEnd();
}
