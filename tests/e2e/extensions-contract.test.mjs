import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer as createViteServer } from "vite";

let vite;
let createServerExtensionMount;
let renderPublicSnapshot;
let ClientExtensionProvider;
let ClientExtensionSlot;

async function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a Vite HMR port."));
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function source() {
  return {
    settings: {
      id: "default", pageName: "Extension mount", tagline: "Typed server extension test.", accentColor: "#16794C", timezone: "UTC", hostname: "extensions.example.test", footerCreditEnabled: true,
      logoKey: null, logoContentType: null, widgetAllowedOrigins: "[]", mailFromAddress: "lamp@extensions.example.test", aiToneInstructions: "", feedId: "extension-mount-test-feed", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
    },
    components: [{ id: "component-1", name: "Public API", description: "", note: "", groupId: null, groupName: null, groupOrder: null, displayOrder: 1 }],
    claims: [{ componentId: "component-1", state: "Major outage" }], history: [], corrections: [], incidents: [], incidentComponents: [], updates: [], maintenance: [], maintenanceComponents: [], reports: [], maintenanceNotices: [],
  };
}

before(async () => {
  const hmrPort = await reservePort();
  vite = await createViteServer({ configFile: false, appType: "custom", server: { middlewareMode: true, hmr: { port: hmrPort } } });
  ({ createServerExtensionMount } = await vite.ssrLoadModule("/src/core/app/extensions/server.ts"));
  ({ renderPublicSnapshot } = await vite.ssrLoadModule("/src/core/features/public-snapshot/renderer.ts"));
  ({ ClientExtensionProvider, ClientExtensionSlot } = await vite.ssrLoadModule("/src/core/app/client/extensions.tsx"));
});

after(async () => { await vite?.close(); });

test("declared server policy, event, and adapter seams mount by stable ID", async () => {
  const observed = [];
  const observedIncidents = [];
  const customMail = { configured: true, send: async () => ({ providerMessageId: "extension-test" }) };
  const mount = createServerExtensionMount({
    policies: {
      "page.status-rollup.v1": () => "Operational",
      "uptime.downtime-states.v1": (state) => state === "Major outage" ? 0.75 : 0,
      "notification.events.v1": { id: "notification.events.v1", channelsForIncidentUpdate: () => ["webhook"] },
    },
    events: { "component.status.changed.v1": [(event) => observed.push(event)] },
    slots: {
      "status-page.header.after.v1": (context) => `<p data-extension-header>${context.pageName}</p>`,
      "status-page.components.after.v1": () => "<p data-extension-components>Component help</p>",
      "status-page.incident.after.v1": (context) => { observedIncidents.push(context.incident); return `<p data-extension-incident>${context.incident.reference}</p>`; },
      "status-page.footer.before.v1": () => "<p data-extension-footer>Support</p>",
    },
    adapters: { "mail.sender.v1": customMail },
  });

  const snapshotSource = source();
  snapshotSource.incidents = [{ id: "incident-1", reference: "INC-001", title: "Public API interruption", lifecycle: "Investigating", openedAt: "2026-09-08T00:00:00.000Z", resolvedAt: null, createdByOperatorId: "operator-1", deletedAt: null, deletionReason: null, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" }];
  snapshotSource.incidentComponents = [{ id: "incident-component-1", incidentId: "incident-1", componentId: "component-1", componentName: "Public API", state: "Major outage", relationship: "Primary", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" }];
  snapshotSource.updates = [{ id: "update-1", incidentId: "incident-1", lifecycle: "Investigating", affectedAudience: "API customers", customerImpact: "Requests fail.", whatStillWorks: "Dashboard access.", details: "Working on recovery.", nextUpdateAt: "2026-09-08T01:00:00.000Z", publishedAt: "2026-09-08T00:00:00.000Z", authorOperatorId: "operator-1", correctsUpdateId: null, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" }];
  const page = renderPublicSnapshot(snapshotSource, "2026-09-08T01:00:00.000Z", mount.publicSnapshotPolicies, { logoDataUrl: null }, mount.slots).artifacts.find((artifact) => artifact.key === "page.html")?.body ?? "";
  assert.match(page, /<h1 id="overall-status" data-overall>Operational<\/h1>/, "the configured page policy controls the page rollup");
  assert.match(page, /<h4>Public API<\/h4>[\s\S]*?<strong>Major outage<\/strong>/, "COMP-006 still controls the individual component state");
  assert.match(page, /Major outage counts as 0\.75 downtime minutes/);
  assert.match(page, /data-extension-header/);
  assert.match(page, /data-extension-components/);
  assert.match(page, /data-extension-incident>INC-001/);
  assert.match(page, /data-extension-footer/);
  assert.deepEqual(observedIncidents, [{ id: "incident-1", reference: "INC-001", title: "Public API interruption", lifecycle: "Investigating" }]);
  assert.deepEqual(mount.notificationEventsPolicy.channelsForIncidentUpdate(), ["webhook"]);
  assert.equal(mount.adapters["mail.sender.v1"], customMail);

  await mount.componentEvents.componentStatusChanged({ componentId: "component-1", previousState: "Operational", state: "Major outage", changedAt: "2026-09-08T01:00:00.000Z", cause: "incident" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(observed, [{ componentId: "component-1", previousState: "Operational", state: "Major outage", changedAt: "2026-09-08T01:00:00.000Z", cause: "incident" }]);
});

test("client component actions receive their row record and can render an interactive contribution", () => {
  let observed;
  let actionCount = 0;
  const inspect = () => { actionCount += 1; };
  const slots = {
    "component.row.actions.v1": (context) => {
      observed = context;
      return createElement("button", { type: "button", "data-component-id": context.component.id, onClick: inspect }, `Inspect ${context.component.name}`);
    },
  };
  const markup = renderToStaticMarkup(createElement(
    ClientExtensionProvider,
    { operatorId: "operator-1", slots },
    createElement(ClientExtensionSlot, {
      id: "component.row.actions.v1",
      context: { component: { id: "component-1", name: "Public API", publicState: "Major outage", groupName: "Public services" } },
    }),
  ));
  assert.match(markup, /<button type="button" data-component-id="component-1">Inspect Public API<\/button>/);
  assert.deepEqual(observed, {
    operatorId: "operator-1",
    component: { id: "component-1", name: "Public API", publicState: "Major outage", groupName: "Public services" },
  });
  inspect();
  assert.equal(actionCount, 1);
});
