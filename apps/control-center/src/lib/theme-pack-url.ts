export function isRemoteThemePackUrl(raw?: string | null): boolean {
  const value = raw?.trim();
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          parsed.origin === "http://127.0.0.1:47832" &&
          parsed.pathname.startsWith("/theme-packs/"))) &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
