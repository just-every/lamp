export type AppJson = null | boolean | number | string | AppJson[] | { [key: string]: AppJson };
export type AppDataSnapshot = Record<string, { data: AppJson; error: string | null }>;

// Only the data used by this visit. A navigation loads a new snapshot; mutations
// and explicit refreshes still read the authoritative API.
export function operatorPageReads(path: string): string[] {
  const components = "/api/app/components";
  switch (path.replace(/\/$/, "")) {
    case "/app": return ["/api/app/overview", "/api/app/communication-performance"];
    case "/app/page": return ["/api/app/overview", "/api/app/page-settings"];
    case "/app/incidents": return ["/api/app/incidents", components];
    case "/app/components": return [components];
    case "/app/maintenance": return ["/api/app/maintenance", components];
    case "/app/subscribers": return ["/api/app/subscribers?limit=100&offset=0", `/api/app/subscriber-reporting?month=${new Date().toISOString().slice(0, 7)}`];
    case "/app/deliveries": return ["/api/app/deliveries?limit=100&offset=0"];
    case "/app/alerts": return ["/api/app/intake/sources", "/api/app/intake/receipts?limit=100", components];
    case "/app/settings": return ["/api/app/ai/status", "/api/app/channels", components, "/api/app/operators", "/api/app/operators/invited", "/api/app/operators/former", "/api/app/overview", "/api/app/website"];
    default: {
      const incident = /^\/app\/incidents\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(path);
      if (!incident) return [];
      const resource = `/api/app/incidents/${incident[1]}`;
      return [resource, `${resource}/brief`, `${resource}/report`, components, "/api/app/ai/status", "/api/app/incident-templates"];
    }
  }
}
