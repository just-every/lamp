import { registerSetupRoutes } from "../features/setup/routes";
import { authResponse } from "../platform/auth/http";
import { Hono } from "hono";

import type { AppBindings, AppEnv } from "./types";
import { isLocalMailExecution, type MailExecution } from "./mail";
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
import { registerOperatorRoutes, requireOperator } from "../features/operators/routes";
import { registerSubscriberRoutes } from "../features/subscribers";
import { registerPublicSnapshotRoutes } from "../features/public-snapshot";
import { registerReportRoutes } from "../features/reports";
import { registerAiRoutes } from "../features/ai";
import { registerBriefRoutes } from "../features/brief";
import { registerStatuspageImportRoutes } from "../features/statuspage-import";
import { registerChannelRoutes } from "../features/channels";

export type { AppBindings } from "./types";

export function createApp(bindings: AppBindings, execution?: MailExecution) {
  const app = new Hono<AppEnv>();
  const healthService = createHealthService(createHealthRepository(bindings.DB), createDependencyProber(bindings.SNAPSHOTS, createQueueDispatcher(bindings.JOBS)));
  const services = createAppServices(bindings, createSnapshotBlobStore(bindings), execution);
  const publicWriteLimiter = createPublicWriteRateLimiter(bindings.DB);
  const localMail = isLocalMailExecution(bindings);

  for (const path of ["/auth/*", "/signin", "/.well-known/rer-*"]) app.all(path, context => authResponse(context.req.raw, bindings, services));
  registerHealthRoutes(app, healthService, bindings);
  registerSetupRoutes(app, services);
  registerPublicSnapshotRoutes(app, services.publicSnapshots);
  app.use("/api/app/*", requireOperator(services.auth));
  // Register the reserved mail-events endpoint before /api/intake/:sourceId.
  registerDeliveryRoutes(app, services.deliveries, { resendWebhookSecret: bindings.RESEND_WEBHOOK_SECRET, relaySecret: bindings.RER_MAIL_RELAY_SECRET, sendGridWebhookPublicKey: bindings.SENDGRID_WEBHOOK_PUBLIC_KEY, mailProvider: bindings.MAIL_PROVIDER, localMail });
  registerIntakeRoutes(app, services.intake, { publicPageHost: bindings.LAMP_PAGE_HOST, rateLimiter: publicWriteLimiter });
  registerOperatorRoutes(app, services.auth, bindings.LAMP_PAGE_HOST);
  registerOverviewRoutes(app, services.overview);
  registerComponentRoutes(app, services.components);
  registerIncidentRoutes(app, services.incidents, { hasChatChannels: async () => (await services.channels.list()).length > 0 });
  registerReportRoutes(app, services.reports);
  registerBriefRoutes(app, services.briefs);
  registerAiRoutes(app, services.ai);
  registerMaintenanceRoutes(app, services.maintenance);
  registerSubscriberRoutes(app, services.subscribers, { rateLimiter: publicWriteLimiter, localMail });
  registerPageSettingsRoutes(app, services.pageSettings);
  registerStatuspageImportRoutes(app, services.statuspageImport);
  registerChannelRoutes(app, services.channels);

  return { app, services };
}
