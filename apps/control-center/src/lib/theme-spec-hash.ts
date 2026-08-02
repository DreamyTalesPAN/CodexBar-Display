export function themeSpecHash(raw: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(raw.trim())) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function themeSpecObjectHash(spec: unknown): string {
  return themeSpecHash(JSON.stringify(spec));
}
