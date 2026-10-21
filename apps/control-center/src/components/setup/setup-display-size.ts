/** Largest whole 240px device scale; below native size, fit whole CSS pixels. */
export function displayPreviewSize(width: number, height: number): number {
  const available = Math.max(0, Math.floor(Math.min(width, height)));
  return available >= 240 ? Math.floor(available / 240) * 240 : available;
}
