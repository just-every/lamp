import { createRetainedSnapshotCache } from "../platform/blobs/retained";
import type { AppBindings } from "./types";
import type { BlobStore } from "../platform/blobs/store";
import { createComponentRepository, createComponentsService } from "../features/components";
import { createDeliveriesService, createDeliveryRepository, notificationPublicationStatements } from "../features/deliveries";
import { createIncidentRepository, createIncidentsService, createUpdateReminders } from "../features/incidents";
import { authOrigin } from "../platform/auth/config";
import { createIntakeRepository, createIntakeService } from "../features/intake";
import { createMaintenanceRepository, createMaintenanceService } from "../features/maintenance";
import { createOverviewRepository } from "../features/overview/repository";
import { createSetupChecklistService } from "../features/overview/setup-checklist";
import { notificationOrigin } from "./mail";
import { createOverviewService } from "../features/overview";
import { createPageSettingsRepository, createPageSettingsService } from "../features/page-settings";
import { createLampAuth } from "../platform/auth";
import { createOperatorRepository } from "../features/operators/repository";
import { createSubscriberRepository, createSubscribersService } from "../features/subscribers";
import { createPublicSnapshotService, createSnapshotRepository, formatTime } from "../features/public-snapshot";
import { createReportRepository, createReportsService } from "../features/reports";
import { createAiService } from "../features/ai";
import { createBriefRepository, createBriefService } from "../features/brief";
import { createStatuspageImportService } from "../features/statuspage-import";
import { createChannelsService } from "../features/channels";
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
  const operators = createOperatorRepository(bindings.DB);
  let authority: ReturnType<typeof createLampAuth> | undefined;
  const auth = () => authority ??= createLampAuth(bindings, mail);
  const components = createComponentsService(createComponentRepository(bindings.DB), publicSnapshots.rebuild, extensions.componentEvents);
  const deliveries = createDeliveriesService(createDeliveryRepository(bindings.DB), {
    effectsPaused: bindings.EFFECTS_PAUSED === "1",
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
  // Slack and Teams channels: webhook URLs sealed with WEBHOOK_SIGNING_SECRET; local dev may name a loopback receiver.
  const channels = createChannelsService(bindings.DB, {
    effectsPaused: bindings.EFFECTS_PAUSED === "1",
    webhookSecret: bindings.WEBHOOK_SIGNING_SECRET,
    developmentReceiver: import.meta.env?.DEV && bindings.LAMP_DEV_CHANNEL_RECEIVER?.startsWith("http://127.0.0.1:") ? bindings.LAMP_DEV_CHANNEL_RECEIVER : undefined,
    publicOrigin: () => notificationOrigin(bindings),
  });
  const incidents = createIncidentsService(createIncidentRepository(bindings.DB), components, publicSnapshots.rebuild, {
    forIncidentUpdate: async (input) => [
      ...notificationPublicationStatements(bindings.DB, { eventId: input.updateId, eventType: "incident-update", incidentUpdateId: input.updateId, componentIds: input.componentIds, channels: input.channels.filter((channel): channel is "email" | "webhook" => channel !== "chat" && allowedIncidentChannels.has(channel)), queuedAt: input.queuedAt }),
      ...(input.channels.includes("chat") ? channels.postStatements({ updateId: input.updateId, componentIds: input.componentIds, queuedAt: input.queuedAt }) : []),
    ],
  }, extensions.updateReviewPolicy,
  async ({ incidentId, draftId, scheduledPublishAt }) => deliveries.queueOperatorAlert({ eventId: `scheduled-review/${draftId}/${scheduledPublishAt}`, title: "Lamp held a scheduled incident update for review", text: `Scheduled update for incident ${incidentId} requires review by another operator before it can publish.` }),
  extensions.updateDuePolicy,
  { events: extensions.events, formatPreviewTimestamp, afterPublished: async () => { await channels.dispatchPending(); } });
  // INCIDENT-010 and NOTIFY-006: one operator email per committed time and kind, sent by the scheduled trigger.
  const updateReminders = createUpdateReminders(bindings.DB, extensions.updateDuePolicy, async ({ kind, incidentId, reference, title, updateId, nextUpdateAt }) => {
    const committed = await formatPreviewTimestamp(nextUpdateAt);
    const link = `${authOrigin(bindings)}/app/incidents/${incidentId}`;
    await deliveries.queueOperatorAlert(kind === "due-soon"
      ? { eventId: `incident-due-soon/${updateId}`, title: `Lamp update due at ${committed}: ${reference}`, text: `${reference} ${title}: the next update you committed to customers is due at ${committed}. Nothing reaches customers until an operator publishes it. Write it here: ${link}` }
      : { eventId: `incident-overdue/${updateId}`, title: `Lamp incident is overdue for an update: ${reference}`, text: `${reference} ${title} passed its next-update commitment of ${committed} with no newer update. The public page still shows that time. Write the update here: ${link}` });
  });
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
  const briefs = createBriefService(createBriefRepository(bindings.DB));
  const ai = createAiService(briefs, aiProvider);
  const overview = createOverviewService(components, incidents, maintenance, createSetupChecklistService(createOverviewRepository(bindings.DB), pageSettings, {
    // The checklist answers an operator request on the app host; the page host
    // shares its scheme and port, as the Settings link to the public page does.
    publicOrigin: async () => {
      if (!(execution instanceof Request)) return notificationOrigin(bindings);
      const origin = new URL(execution.url);
      origin.hostname = bindings.LAMP_PAGE_HOST;
      return origin.origin;
    },
    sender: { local: capturesLocally, provider: bindings.MAIL_PROVIDER ?? "resend", apiKey: bindings.MAIL_PROVIDER_API_KEY, mail },
  }));

  // Imported subscribers each get one confirmation invite; past incidents notify no one.
  const statuspageImport = createStatuspageImportService(bindings.DB, {
    inviteSubscriber: async (subscriberId, claimSend) => subscribers.inviteImported(subscriberId, await notificationOrigin(bindings), (await pageSettings.get())?.pageName ?? "This status page", claimSend),
    publicDataChanged: () => publicSnapshots.rebuild(true),
  }, { apiOrigin: import.meta.env?.DEV && bindings.LAMP_DEV_STATUSPAGE_ORIGIN?.startsWith("http://127.0.0.1:") ? bindings.LAMP_DEV_STATUSPAGE_ORIGIN : undefined });

  return { capturesMailLocally: capturesLocally, auth, operators, pageSettings, components, incidents, maintenance, subscribers, deliveries, reports, intake, briefs, ai, overview, updateReminders, publicSnapshots, statuspageImport, channels };
}

export type AppServices = ReturnType<typeof createAppServices>;
