import { registerBootstrapRoutes } from "../features/bootstrap/routes";
import { Hono } from "hono";

import type { AppBindings, AppEnv } from "./types";
import type { MailExecution } from "./mail";
import { createAppServices } from "./services";
import { createSnapshotBlobStore } from "../platform/blobs/r2";
import { createDependencyProber } from "../platform/health";
import { createQueueDispatcher } from "../platform/jobs";
import { createPublicWriteRateLimiter } from "../platform/security/rate-limiter";
import { registerComponentRoutes } from "../features/components";
import { registerDeliveryRoutes } from "../features/deliveries";
import { createHealthRepository } from "../features/health/repository";
import { registerHealthRoutes } from "../features/health/routes";
import { createHealthService } from "../features/health/service";
import { registerIncidentRoutes } from "../features/incidents";
import { registerIntakeRoutes } from "../features/intake";
import { registerMaintenanceRoutes } from "../features/maintenance";
import { registerOverviewRoutes } from "../features/overview";
import { registerPageSettingsRoutes } from "../features/page-settings";
import { registerSessionRoutes, requireOperator } from "../features/session";
import { registerSubscriberRoutes } from "../features/subscribers";
import { registerPublicSnapshotRoutes } from "../features/public-snapshot";
import { registerReportRoutes } from "../features/reports";
import { registerAiRoutes } from "../features/ai";

export type { AppBindings } from "./types";

export function createApp(bindings: AppBindings, execution?: MailExecution) {
  const app = new Hono<AppEnv>();
  const healthService = createHealthService(createHealthRepository(bindings.DB), createDependencyProber(bindings.SNAPSHOTS, createQueueDispatcher(bindings.JOBS)));
  const services = createAppServices(bindings, createSnapshotBlobStore(bindings), execution);
  const publicWriteLimiter = createPublicWriteRateLimiter(bindings.DB);

  registerHealthRoutes(app, healthService);
  registerBootstrapRoutes(app, services, publicWriteLimiter);
  registerPublicSnapshotRoutes(app, services.publicSnapshots);
  app.use("/api/app/*", requireOperator(services.session));
  // Register the reserved mail-events endpoint before /api/intake/:sourceId.
  registerDeliveryRoutes(app, services.deliveries, { resendWebhookSecret: bindings.RESEND_WEBHOOK_SECRET, relaySecret: bindings.RER_MAIL_RELAY_SECRET, sendGridWebhookPublicKey: bindings.SENDGRID_WEBHOOK_PUBLIC_KEY, mailProvider: bindings.MAIL_PROVIDER });
  registerIntakeRoutes(app, services.intake, { rateLimiter: publicWriteLimiter });
  registerSessionRoutes(app, services.session, { publicPageHost: bindings.LAMP_PAGE_HOST, localMailCapture: services.capturesMailLocally, rateLimiter: publicWriteLimiter });
  registerOverviewRoutes(app, services.overview);
  registerComponentRoutes(app, services.components);
  registerIncidentRoutes(app, services.incidents);
  registerReportRoutes(app, services.reports);
  registerAiRoutes(app, services.ai);
  registerMaintenanceRoutes(app, services.maintenance);
  registerSubscriberRoutes(app, services.subscribers, { localMailCapture: services.capturesMailLocally, rateLimiter: publicWriteLimiter });
  registerPageSettingsRoutes(app, services.pageSettings);

  return { app, services };
}
