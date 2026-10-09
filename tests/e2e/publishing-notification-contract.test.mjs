import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { test } from "node:test";
import { createServer as createViteServer } from "vite";

import { contract } from "../contract.mjs";

function d1Literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  throw new Error(`The notification fixture cannot bind ${typeof value} to local D1.`);
}

function executeD1(persistTo, statement, json = false) {
  const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", persistTo, "--command", statement, ...(json ? ["--json"] : [])], { cwd: process.cwd(), encoding: json ? "utf8" : undefined, stdio: json ? undefined : "pipe" });
  if (!json) return undefined;
  const [result] = JSON.parse(output);
  if (!result?.success) throw new Error(`Notification fixture query failed: ${statement}`);
  return result.results;
}

function createD1Binding(persistTo) {
  return {
    prepare(sql) {
      const statementFor = (values) => {
        const statement = () => {
          let index = 0;
          const rendered = sql.replaceAll("?", () => d1Literal(values[index++]));
          if (index !== values.length) throw new Error("Notification fixture did not bind every repository parameter.");
          return rendered;
        };
        return {
          bind: (...nextValues) => statementFor(nextValues),
          all: async () => ({ results: executeD1(persistTo, statement(), true) }),
          first: async () => executeD1(persistTo, statement(), true)[0] ?? null,
          raw: async () => executeD1(persistTo, statement(), true).map((row) => Object.values(row)),
          run: async () => {
            executeD1(persistTo, statement());
            return { meta: { changes: 0 } };
          },
        };
      };
      return statementFor([]);
    },
  };
}

async function reserveHmrPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a Vite HMR port."));
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function loadFactories() {
  const hmrPort = await reserveHmrPort();
  const vite = await createViteServer({ configFile: false, appType: "custom", server: { middlewareMode: true, hmr: { port: hmrPort } } });
  try {
    const [incidents, incidentRepository, deliveryRepository, deliveryService] = await Promise.all([
      vite.ssrLoadModule("/src/core/features/incidents/service.ts"),
      vite.ssrLoadModule("/src/core/features/incidents/repository.ts"),
      vite.ssrLoadModule("/src/core/features/deliveries/repository.ts"),
      vite.ssrLoadModule("/src/core/features/deliveries/service.ts"),
    ]);
    return {
      createIncidentsService: incidents.createIncidentsService,
      createIncidentRepository: incidentRepository.createIncidentRepository,
      createDeliveryRepository: deliveryRepository.createDeliveryRepository,
      createDeliveriesService: deliveryService.createDeliveriesService,
    };
  } finally {
    await vite.close();
  }
}

function createFixture() {
  const persistTo = mkdtempSync("/tmp/lamp-notification-contract-");
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", persistTo], { cwd: process.cwd(), stdio: "pipe" });
  const timestamp = "2026-09-08T00:00:00.000Z";
  executeD1(persistTo, `
    INSERT INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at) VALUES ('01J00000000000000000000001','operator@example.test','Operator',1,'${timestamp}','${timestamp}');
    INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,peak_impact,created_at,updated_at) VALUES ('01J00000000000000000000091','INC-9001','Overdue event fixture','Identified','${timestamp}',NULL,'01J00000000000000000000001',NULL,NULL,'Major outage','${timestamp}','${timestamp}');
    INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,corrects_update_id,created_at,updated_at) VALUES ('01J00000000000000000000094','01J00000000000000000000091','Identified','API customers','Writes fail','Reads remain available.','The first immutable update is overdue.','2020-01-01T01:00:00.000Z','${timestamp}','01J00000000000000000000001',NULL,'${timestamp}','${timestamp}');
  `);
  return persistTo;
}

contract("NOTIFY-006", "a repeated overdue scan creates one alert per immutable update in the real D1 outbox", async () => {
  const persistTo = createFixture();
  try {
    const { createIncidentsService, createIncidentRepository, createDeliveryRepository, createDeliveriesService } = await loadFactories();
    const binding = createD1Binding(persistTo);
    const deliveries = createDeliveriesService(createDeliveryRepository(binding), { fromAddress: "lamp@example.test" });
    const incidents = createIncidentsService(createIncidentRepository(binding), {}, async () => {}, null, undefined, async () => {}, async ({ updateId }) => deliveries.queueOperatorAlert({
      eventId: `incident-overdue/${updateId}`, title: "Lamp incident update is overdue", text: `Update ${updateId} is overdue.`,
    }));

    await incidents.list();
    await incidents.list();
    executeD1(persistTo, `INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,corrects_update_id,created_at,updated_at) VALUES ('01J00000000000000000000097','01J00000000000000000000091','Monitoring','API customers','Writes remain delayed','Reads remain available.','The later immutable update is overdue.','2020-01-01T02:00:00.000Z','2026-09-08T00:30:00.000Z','01J00000000000000000000001',NULL,'2026-09-08T00:30:00.000Z','2026-09-08T00:30:00.000Z')`);
    assert.deepEqual(executeD1(persistTo, "SELECT id FROM incident_updates WHERE incident_id = '01J00000000000000000000091' ORDER BY published_at ASC", true), [{ id: "01J00000000000000000000094" }, { id: "01J00000000000000000000097" }]);
    await incidents.list();
    await incidents.list();
    assert.deepEqual(executeD1(persistTo, "SELECT aggregate_id AS eventId FROM notification_outbox WHERE kind = 'operator-alert' ORDER BY aggregate_id", true), [
      { eventId: "incident-overdue/01J00000000000000000000094" },
      { eventId: "incident-overdue/01J00000000000000000000097" },
    ]);
  } finally {
    rmSync(persistTo, { recursive: true, force: true });
  }
});
