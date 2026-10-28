import { createLampAgentDoor } from '../features/agent-door/index.server';
import { registerIncidentFollowSettingsRoutes } from "../features/subscribers/incident-follow-settings.routes";
import { registerTrafficAlertRoutes } from "../features/traffic-alerts/routes";
import { registerSmsRoutes } from "../features/sms/routes";
import { createManagementApiService } from "../features/management-api/service";
import { registerManagementApiRoutes } from "../features/management-api/routes";
import { registerMetricsRoutes } from "../features/metrics/routes";
import { createSlackSubscriptionsService, registerSlackSubscriptionRoutes } from "../features/subscribers/slack-subscriptions";
import { registerTeamsSubscriptionRoutes } from "../features/subscribers/teams-routes";
import { registerChatDeskRoutes } from "../features/chat-desk";
import { registerAvailabilityReportRoutes } from "../features/availability-reports";
import { createSubscriberReportingRepository, createSubscriberReportingService, registerSubscriberReportingRoutes } from "../features/subscriber-reporting";
import { registerCommunicationPerformanceRoutes } from "../features/communication-performance";
import { registerAuditLogRoutes } from "../features/audit-log/routes";
import { createAuditLogRepository } from "../features/audit-log/repository";
import { registerIncidentImpactRoutes } from "../features/incident-impact";
import { registerSetupRoutes } from "../features/setup/routes";
import { createSetupRepository } from "../features/setup/repository";
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
import { registerCatalogueRoutes } from "../features/components/catalogue-routes";
import { registerMailSettings } from "../features/deliveries/mail-settings";
import { registerDeliveryRoutes } from "../features/deliveries";
import { createHealthRepository } from "../features/health/repository";
import { registerHealthRoutes } from "../features/health/routes";
import { createHealthService } from "../features/health/service";
import { registerIncidentRoutes } from "../features/incidents";
import { registerIntakeRoutes } from "../features/intake";
import { registerMaintenanceRoutes } from "../features/maintenance";
import { registerOverviewRoutes } from "../features/overview";
import { registerPageSettingsRoutes } from "../features/page-settings";
import { registerWebsiteRoutes } from "../features/website";
import { registerOperatorRoutes, requireOperator, type OperatorReadSession } from "../features/operators/routes";
import { registerSubscriberRoutes } from "../features/subscribers";
import { registerPublicSnapshotRoutes } from "../features/public-snapshot";
import { registerReportRoutes } from "../features/reports";
import { registerAiRoutes } from "../features/ai";
import { registerBriefRoutes } from "../features/brief";
import { registerStatuspageImportRoutes } from "../features/statuspage-import";
import { registerImportDoor } from '../features/statuspage-import/door';
import { registerRerCutoverStatus } from '../features/statuspage-import/rer-cutover-status';
import { registerSocialRoutes } from "../features/social/routes";
import { registerChannelRoutes } from "../features/channels";
import { registerPageExportRoutes } from "../features/page-export";

export type { AppBindings } from "./types";

export function createApp(bindings: AppBindings, execution?: MailExecution) {
  const app = new Hono<AppEnv>();
  const authorizedReads = new WeakMap<Request, OperatorReadSession>();
  const services = createAppServices(bindings, createSnapshotBlobStore(bindings), execution);
  const healthService = createHealthService(createHealthRepository(bindings.DB), createDependencyProber(bindings.SNAPSHOTS, createQueueDispatcher(bindings.JOBS)), async () => {
    if (await services.publicSnapshots.hasCurrentSnapshot()) return true;
    if (!await createSetupRepository(bindings.DB).pageConfigured()) return false;
    await services.publicSnapshots.retryPendingBuild();
    return services.publicSnapshots.hasCurrentSnapshot();
  });
  const publicWriteLimiter = createPublicWriteRateLimiter(bindings.DB);
  registerSlackSubscriptionRoutes(app,createSlackSubscriptionsService(bindings.DB,{
    clientId:bindings.SLACK_CLIENT_ID,clientSecret:bindings.SLACK_CLIENT_SECRET,signingSecret:bindings.SLACK_SIGNING_SECRET,
    webhookSecret:bindings.WEBHOOK_SIGNING_SECRET,tokenSecret:bindings.SUBSCRIBER_TOKEN_SECRET,pageName:()=>services.subscribers.getPageName(),limitsChanged:()=>services.subscribers.checkLimits(),
  }),publicWriteLimiter);
  // Local development says its mail is suppressed; a demo completes sends as
  // mocked success, so its pages read as a configured installation's.
  const localMail = isLocalMailExecution(bindings) && bindings.RER_DEMO !== '1';

  for (const path of ["/auth/*", "/signin", "/.well-known/rer-*"]) app.all(path, context => authResponse(context.req.raw, bindings, services));
  registerHealthRoutes(app, healthService, bindings);
  registerSetupRoutes(app, services);
  registerPublicSnapshotRoutes(app, services.publicSnapshots);
  app.use("/api/app/*", requireOperator(services.auth, request => authorizedReads.get(request)));
  // Register the reserved mail-events endpoint before /api/intake/:sourceId.
  registerDeliveryRoutes(app, services.deliveries, { resendWebhookSecret: bindings.RESEND_WEBHOOK_SECRET, relaySecret: bindings.RER_MAIL_RELAY_SECRET, sendGridWebhookPublicKey: bindings.SENDGRID_WEBHOOK_PUBLIC_KEY, mailgunSigningKey: bindings.MAILGUN_WEBHOOK_SIGNING_KEY, sesEventTopicArn: bindings.SES_EVENT_TOPIC_ARN, postmarkWebhookSecret: bindings.POSTMARK_WEBHOOK_SECRET, secondaryMailProvider: bindings.MAIL_SECONDARY_PROVIDER, mailProvider: bindings.MAIL_PROVIDER, localMail, smsConfigured: services.sms.configured });
  registerMailSettings(app,bindings);
  registerTrafficAlertRoutes(app, services.trafficStorage);
  registerMetricsRoutes(app, services.metrics);
  registerManagementApiRoutes(app, createManagementApiService(bindings.DB, services.auth), services.metrics, publicWriteLimiter, services.components);
  registerIntakeRoutes(app, services.intake, { publicPageHost: bindings.LAMP_PAGE_HOST, onUptimeTiming: services.metrics.acceptUptime, rateLimiter: publicWriteLimiter });
  registerOperatorRoutes(app, services.auth, bindings.LAMP_PAGE_HOST, { localMail });
  registerOverviewRoutes(app, services.overview);
  registerAuditLogRoutes(app, createAuditLogRepository(bindings.DB));
  registerSubscriberReportingRoutes(app, createSubscriberReportingService(createSubscriberReportingRepository(bindings.DB)));
  registerCommunicationPerformanceRoutes(app, services.communicationPerformance);
  registerAvailabilityReportRoutes(app, services.availabilityReports);
  registerCatalogueRoutes(app, services.componentCatalogue);
  registerComponentRoutes(app, services.components);
  registerIncidentRoutes(app, services.incidents, { hasChatChannels: async () => (await services.channels.list()).length > 0, wordingChecks: async () => { const settings = await services.pageSettings.get(); if (!settings) throw new Error("Page settings are not configured."); return { blockedTerms: settings.wordingBlockedTerms, friendlyLength: settings.wordingFriendlyLength }; } });
  registerIncidentImpactRoutes(app, services.incidentImpact);
  registerReportRoutes(app, services.reports);
  registerBriefRoutes(app, services.briefs);
  registerAiRoutes(app, services.ai);
  registerMaintenanceRoutes(app, services.maintenance);
  registerSubscriberRoutes(app, services.subscribers, { rateLimiter: publicWriteLimiter });
  registerIncidentFollowSettingsRoutes(app,bindings.DB);
  registerSmsRoutes(app,services.sms,()=>services.subscribers.getPageName(),bindings.TWILIO_AUTH_TOKEN,publicWriteLimiter);
  registerTeamsSubscriptionRoutes(app, services.teamsSubscriptions, services.subscribers, publicWriteLimiter);
  registerPageSettingsRoutes(app, services.pageSettings, (key) => services.publicSnapshots.readArtifact(key));
  registerWebsiteRoutes(app, services.website);
  registerPageExportRoutes(app, services.pageExport);
  registerStatuspageImportRoutes(app, services.statuspageImport);
  registerImportDoor(app, bindings, services.statuspageImport,()=>services.publicSnapshots.rebuild(true), services.auth);
  registerRerCutoverStatus(app, bindings);
  registerChannelRoutes(app, services.channels);
  registerSocialRoutes(app, services.social);
  registerChatDeskRoutes(app, services.chatDesk, services.components);

  async function readOperator(path: string, source: Request, authority: OperatorReadSession) {
    const request = new Request(new URL(path, source.url), { headers: source.headers });
    authorizedReads.set(request, authority);
    try { return await app.fetch(request, bindings); }
    finally { authorizedReads.delete(request); }
  }
  return { app, services, readOperator, health: healthService, agentDoor: createLampAgentDoor(services, bindings) };
}
