// Keep the original GIF header, palette, extensions, and first compressed image.
// One image cannot animate; no pixel decoder or additional frame cache is needed.
export function staticGif(base64: string): string {
  try {
    const bytes = atob(base64);
    if (bytes.length < 13 || !/^GIF8[79]a/.test(bytes)) return "";
    const byte = (i: number) => bytes.charCodeAt(i);
    const paletteBytes = (packed: number) =>
      packed & 0x80 ? 3 << ((packed & 7) + 1) : 0;
    let offset = 13 + paletteBytes(byte(10));
    const skipBlocks = () => {
      while (offset < bytes.length) {
        const size = byte(offset++);
        if (size === 0) return true;
        offset += size;
      }
      return false;
    };
    while (offset < bytes.length) {
      const marker = byte(offset++);
      if (marker === 0x21) {
        offset++; // Extension label; all extensions use length-prefixed blocks.
        if (!skipBlocks()) return "";
      } else if (marker === 0x2c && offset + 9 <= bytes.length) {
        const packed = byte(offset + 8);
        offset += 9 + paletteBytes(packed) + 1; // Descriptor, local palette, LZW size.
        return skipBlocks() ? btoa(bytes.slice(0, offset) + "\x3b") : "";
      } else {
        return "";
      }
    }
  } catch {
    /* Malformed assets must not bypass animation-off. */
  }
  return "";
}
