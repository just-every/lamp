import { createRetainedSnapshotCache } from "../platform/blobs/retained";
import type { AppBindings } from "./types";
import type { BlobStore } from "../platform/blobs/store";
import { createComponentRepository, createComponentsService } from "../features/components";
import { createDeliveriesService, createDeliveryRepository, notificationPublicationStatements } from "../features/deliveries";
import { createIncidentRepository, createIncidentsService } from "../features/incidents";
import { createIntakeRepository, createIntakeService } from "../features/intake";
import { createMaintenanceRepository, createMaintenanceService } from "../features/maintenance";
import { createOverviewService } from "../features/overview";
import { createPageSettingsRepository, createPageSettingsService } from "../features/page-settings";
import { createSessionRepository, createSessionService } from "../features/session";
import { createSubscriberRepository, createSubscribersService } from "../features/subscribers";
import { createPublicSnapshotService, createSnapshotRepository, formatTime } from "../features/public-snapshot";
import { createReportRepository, createReportsService } from "../features/reports";
import { createAiRepository, createAiService } from "../features/ai";
import { createAppMailTransport, type MailExecution } from "./mail";
import { createOpenAiCompatibleProvider } from "../platform/ai";
import { createServerExtensionMount } from "./extensions/server";

export function createAppServices(bindings: AppBindings, blobs: BlobStore, execution?: MailExecution) {
  const extensions = createServerExtensionMount();
  const { sender: mail, capturesLocally } = createAppMailTransport(bindings, extensions.adapters["mail.sender.v1"], execution);
  const publicSnapshots = createPublicSnapshotService(createSnapshotRepository(bindings.DB), blobs, extensions.publicSnapshotPolicies, extensions.publicSnapshotEvents, extensions.slots, createRetainedSnapshotCache(bindings));
  const pageSettings = createPageSettingsService(createPageSettingsRepository(bindings.DB), publicSnapshots.rebuild, blobs, bindings.MAIL_FROM_ADDRESS);
  const configuredFromAddress = async () => (await pageSettings.get())?.mailFromAddress ?? bindings.MAIL_FROM_ADDRESS;
  const formatPreviewTimestamp = async (timestamp: string) => {
    const settings = await pageSettings.get();
    if (!settings) throw new Error("Lamp cannot render an update preview before page settings are configured.");
    return formatTime(timestamp, settings.timezone);
  };
  const session = createSessionService(createSessionRepository(bindings.DB), mail, configuredFromAddress);
  const components = createComponentsService(createComponentRepository(bindings.DB), publicSnapshots.rebuild, extensions.componentEvents);
  const deliveries = createDeliveriesService(createDeliveryRepository(bindings.DB), {
    mail,
    fromAddress: configuredFromAddress,
    subscriberTokenSecret: bindings.SUBSCRIBER_TOKEN_SECRET,
    webhookSigningSecret: bindings.WEBHOOK_SIGNING_SECRET?.split(",").map((secret) => secret.trim()).filter(Boolean),
    events: {
      subscriberDeactivated: extensions.events.subscriberDeactivated,
      notificationFailed: extensions.events.notificationFailed,
    },
  });
  const allowedIncidentChannels = new Set(extensions.notificationEventsPolicy.channelsForIncidentUpdate());
  const incidents = createIncidentsService(createIncidentRepository(bindings.DB), components, publicSnapshots.rebuild, {
    forIncidentUpdate: async (input) => notificationPublicationStatements(bindings.DB, { eventId: input.updateId, eventType: "incident-update", incidentUpdateId: input.updateId, componentIds: input.componentIds, channels: input.channels.filter((channel) => allowedIncidentChannels.has(channel)), queuedAt: input.queuedAt }),
  }, extensions.updateReviewPolicy,
  async ({ incidentId, draftId, scheduledPublishAt }) => deliveries.queueOperatorAlert({ eventId: `scheduled-review/${draftId}/${scheduledPublishAt}`, title: "Lamp held a scheduled incident update for review", text: `Scheduled update for incident ${incidentId} requires review by another operator before it can publish.` }),
  async ({ incidentId, updateId }) => deliveries.queueOperatorAlert({ eventId: `incident-overdue/${updateId}`, title: "Lamp incident is overdue for an update", text: `Incident ${incidentId} has passed its next-update commitment.` }),
  { events: extensions.events, formatPreviewTimestamp });
  const maintenance = createMaintenanceService(createMaintenanceRepository(bindings.DB), components, publicSnapshots.rebuild, {
    forMaintenanceNotice: async (input) => notificationPublicationStatements(bindings.DB, { eventId: input.eventId, eventType: "maintenance-notice", maintenanceId: input.maintenanceId, componentIds: input.componentIds, channels: ["email", "webhook"], queuedAt: input.queuedAt, recipientScope: input.recipientScope, previousEventIds: input.previousEventIds }),
  }, extensions.maintenanceRemindersPolicy,
  async ({ maintenanceId, endsAt }) => deliveries.queueOperatorAlert({ eventId: `maintenance-overrun/${maintenanceId}/${endsAt}`, title: "Lamp maintenance is running longer than planned", text: `Maintenance ${maintenanceId} is still in progress more than fifteen minutes after its scheduled end.` }),
  extensions.events);
  const subscribers = createSubscribersService(createSubscriberRepository(bindings.DB), {
    mail,
    fromAddress: configuredFromAddress,
    tokenSecret: bindings.SUBSCRIBER_TOKEN_SECRET,
    confirmationPolicy: extensions.subscriberConfirmationPolicy,
    events: {
      subscriberConfirmed: extensions.events.subscriberConfirmed,
      subscriberDeactivated: extensions.events.subscriberDeactivated,
    },
  });
  const reports = createReportsService(createReportRepository(bindings.DB), publicSnapshots.rebuild, extensions.postmortemDuePolicy, {
    forIncidentReport: async (input) => notificationPublicationStatements(bindings.DB, { eventId: input.eventId, eventType: "incident-report", incidentReportId: input.eventId, componentIds: input.componentIds, channels: input.channels, queuedAt: input.queuedAt }),
  });
  const intake = createIntakeService(createIntakeRepository(bindings.DB), extensions.alertIntakePolicy, async (incidentId) => deliveries.queueOperatorAlert({ eventId: `intake-draft/${incidentId}`, title: "Lamp alert intake created an incident draft", text: `A configured alert source created draft incident ${incidentId}; review and publish it if customer communication is needed.` }), extensions.events);
  const aiValues = [bindings.AI_PROVIDER_URL, bindings.AI_PROVIDER_API_KEY, bindings.AI_PROVIDER_MODEL];
  const configuredAiValues = aiValues.filter((value) => Boolean(value)).length;
  if (configuredAiValues > 0 && configuredAiValues !== aiValues.length) {
    throw new Error("Lamp AI requires AI_PROVIDER_URL, AI_PROVIDER_API_KEY, and AI_PROVIDER_MODEL together.");
  }
  if (extensions.adapters["ai.provider.v1"] && configuredAiValues > 0) {
    throw new Error("Lamp cannot configure AI_PROVIDER_* values alongside the ai.provider.v1 extension adapter.");
  }
  const aiProvider = extensions.adapters["ai.provider.v1"] ?? (configuredAiValues === aiValues.length
    ? createOpenAiCompatibleProvider({ endpoint: bindings.AI_PROVIDER_URL!, apiKey: bindings.AI_PROVIDER_API_KEY!, model: bindings.AI_PROVIDER_MODEL! })
    : null);
  const ai = createAiService(createAiRepository(bindings.DB), aiProvider);
  const overview = createOverviewService(components, incidents, maintenance);

  return { capturesMailLocally: capturesLocally, session, pageSettings, components, incidents, maintenance, subscribers, deliveries, reports, intake, ai, overview, publicSnapshots };
}

export type AppServices = ReturnType<typeof createAppServices>;
