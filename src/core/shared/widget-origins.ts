export class WidgetAllowedOriginsConfigurationError extends Error {
  constructor() {
    super("Stored widget allowed-origin configuration is invalid.");
    this.name = "WidgetAllowedOriginsConfigurationError";
  }
}

/**
 * Settings writes validate this shape at the API boundary. A database value is
 * still untrusted: snapshot and operator reads must expose corruption instead
 * of silently changing the widget's access policy.
 */
export function parseWidgetAllowedOrigins(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new WidgetAllowedOriginsConfigurationError();
  }
  if (!Array.isArray(parsed) || !parsed.every((origin) => typeof origin === "string")) {
    throw new WidgetAllowedOriginsConfigurationError();
  }
  return parsed;
}
