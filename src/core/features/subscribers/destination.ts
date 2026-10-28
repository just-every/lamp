export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }

export function hasSafeWebhookDestination(value: string) {
  try {
    const url = new URL(value), hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
    if (/^(?:127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(hostname) || hostname === "::1") return false;
    return true;
  } catch { return false; }
}
