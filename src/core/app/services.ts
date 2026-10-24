import { createTeamsSubscriptionsService } from "../features/subscribers/teams-subscriptions";
import { createPromiseDraftRepository } from "../features/incidents/promise-draft.repository";
import { createPromiseDraftPreparer } from "../features/incidents/promise-draft.service";
import { createCommunicationOwnerRepository } from "../features/incidents/communication-owner.repository";
import { createChatDeskService } from "../features/chat-desk";
import { createResponderService } from "../features/intake/responder-service";
import { createAvailabilityReportRepository, createAvailabilityReportService } from "../features/availability-reports";
import { createCommunicationPerformanceRepository, createCommunicationPerformanceService } from "../features/communication-performance";
import { createIncidentImpactRepository, createIncidentImpactService } from "../features/incident-impact";
import { brandEmail } from "../shared/email-branding";
import { publicPageOrigin } from "./public-origin";
import { createRetainedSnapshotCache } from "../platform/blobs/retained";
import type { AppBindings } from "./types";
import type { BlobStore } from "../platform/blobs/store";
import { createComponentRepository, createComponentsService } from "../features/components";
import { createCatalogueRepository } from "../features/components/catalogue.repository";
import { createCatalogueService } from "../features/components/catalogue-service";
import { createDeliveriesService, createDeliveryRepository, notificationPublicationStatements, incidentCatchupStatements } from "../features/deliveries";
import { createIncidentRepository, createIncidentsService, createUpdateReminders } from "../features/incidents";
import { authOrigin } from "../platform/auth/config";
import { createIntakeRepository, createIntakeService } from "../features/intake";
import { createMaintenanceRepository, createMaintenanceService } from "../features/maintenance";
import { createOverviewRepository } from "../features/overview/repository";
import { createLiveStatusService } from "../features/overview/live-status";
import { createWebsiteRepository, createWebsiteService, websiteReader, statusPageReader, statusFeedCapture } from "../features/website";
import { notificationOrigin } from "./mail";
import { outboundUnavailable } from "./hosting";
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
import { createPageExportRepository, createPageExportService } from "../features/page-export";
import { createAppMailTransport, type MailExecution } from "./mail";
import { createOpenAiCompatibleProvider } from "../platform/ai";
import { createDemoAiProvider } from "../platform/ai/demo";
import { createServerExtensionMount } from "./extensions/server";

export function createAppServices(bindings: AppBindings, blobs: BlobStore, execution?: MailExecution) {
  const extensions = createServerExtensionMount();
  const { sender: mail, local } = createAppMailTransport(bindings, extensions.adapters["mail.sender.v1"], execution);
  const snapshotOrigin = bindings.LAMP_LOCAL_ORIGIN ? publicPageOrigin(bindings.LAMP_LOCAL_ORIGIN, bindings.LAMP_PAGE_HOST) : undefined;
  const publicSnapshots = createPublicSnapshotService(createSnapshotRepository(bindings.DB, snapshotOrigin), blobs, extensions.publicSnapshotPolicies, extensions.publicSnapshotEvents, extensions.slots, createRetainedSnapshotCache(bindings));
  const incidentImpact = createIncidentImpactService(createIncidentImpactRepository(bindings.DB), publicSnapshots.rebuild);
  const pageSettings = createPageSettingsService(createPageSettingsRepository(bindings.DB), publicSnapshots.rebuild, blobs, bindings.MAIL_FROM_ADDRESS, bindings.MAIL_PROVIDER !== "rer");
  const configuredFromAddress = async () => (await pageSettings.get())?.mailFromAddress ?? bindings.MAIL_FROM_ADDRESS;
  const configuredPageName = async () => {
    const settings = await pageSettings.get();
    if (!settings) throw new Error("Page settings are not configured.");
    return settings.pageName;
  };
  const formatPreviewTimestamp = async (timestamp: string) => {
    const settings = await pageSettings.get();
    if (!settings) throw new Error("Lamp cannot render an update preview before page settings are configured.");
    return formatTime(timestamp, settings.timezone);
  };
  const operators = createOperatorRepository(bindings.DB);
  let authority: ReturnType<typeof createLampAuth> | undefined;
  const auth = () => authority ??= createLampAuth(bindings, mail);
  const components = createComponentsService(createComponentRepository(bindings.DB), publicSnapshots.rebuild, extensions.componentEvents);
  const componentCatalogue = createCatalogueService(createCatalogueRepository(bindings.DB), publicSnapshots.rebuild);
  // Slack and Teams channels: webhook URLs sealed with WEBHOOK_SIGNING_SECRET; local dev may name a loopback receiver.
  const channels = createChannelsService(bindings.DB, {
    effectsPaused: bindings.EFFECTS_PAUSED === "1",
    webhookSecret: bindings.WEBHOOK_SIGNING_SECRET,
    developmentReceiver: import.meta.env?.DEV && bindings.LAMP_DEV_CHANNEL_RECEIVER?.startsWith("http://127.0.0.1:") ? bindings.LAMP_DEV_CHANNEL_RECEIVER : undefined,
    publicOrigin: () => notificationOrigin(bindings),
    unavailable: outboundUnavailable(bindings, "Slack and Teams posts"),
  });
  const deliveries = createDeliveriesService(createDeliveryRepository(bindings.DB), {
    operatorChatAlert: input => channels.queueOperatorAlert({ ...input, appOrigin: authOrigin(bindings) }),
    pageStatusRollup: extensions.publicSnapshotPolicies.pageStatusRollup,
    effectsPaused: bindings.EFFECTS_PAUSED === "1",
    mail,
    pageName: configuredPageName,
    emailBranding: async () => { const settings = await pageSettings.get(); if (!settings) throw new Error("Page settings are not configured."); return { branding: settings.emailBranding, hasLogo: Boolean(settings.logoKey) }; },
    fromAddress: configuredFromAddress,
    subscriberTokenSecret: bindings.SUBSCRIBER_TOKEN_SECRET,
    webhookSigningSecret: bindings.WEBHOOK_SIGNING_SECRET?.split(",").map((secret) => secret.trim()).filter(Boolean),
    events: {
      subscriberDeactivated: extensions.events.subscriberDeactivated,
      notificationFailed: extensions.events.notificationFailed,
    },
  });
  const allowedIncidentChannels = new Set(extensions.notificationEventsPolicy.channelsForIncidentUpdate());
  const responders = createResponderService(bindings.DB, {
    effectsPaused: bindings.EFFECTS_PAUSED === "1", webhookSecret: bindings.WEBHOOK_SIGNING_SECRET,
    publicOrigin: () => notificationOrigin(bindings),
  });
  const incidents = createIncidentsService(createIncidentRepository(bindings.DB), components, publicSnapshots.rebuild, {
    forAttachedComponents: async (input) => incidentCatchupStatements(bindings.DB, input),
    forIncidentUpdate: async (input) => [
      ...responders.publicationStatements(input),
      ...notificationPublicationStatements(bindings.DB, { eventId: input.updateId, eventType: "incident-update", incidentUpdateId: input.updateId, componentIds: input.componentIds, channels: input.channels.filter((channel): channel is "email" | "webhook" => channel !== "chat" && allowedIncidentChannels.has(channel)), queuedAt: input.queuedAt }),
      ...(input.channels.includes("chat") ? channels.postStatements({ updateId: input.updateId, componentIds: input.componentIds, queuedAt: input.queuedAt }) : []),
    ],
  }, extensions.updateReviewPolicy,
  async ({ incidentId, draftId, scheduledPublishAt }) => deliveries.queueOperatorAlert({ eventId: `scheduled-review/${draftId}/${scheduledPublishAt}`, title: "Lamp held a scheduled incident update for review", text: `Scheduled update for incident ${incidentId} requires review by another operator before it can publish.` }),
  extensions.updateDuePolicy,
  { events: extensions.events, formatPreviewTimestamp, formatPreviewEmail: async (email) => {
    const settings = await pageSettings.get();
    if (!settings) throw new Error("Page settings are not configured.");
    return brandEmail(email, { branding: settings.emailBranding, pageName: settings.pageName, fromAddress: settings.mailFromAddress, origin: publicPageOrigin(authOrigin(bindings), bindings.LAMP_PAGE_HOST), hasLogo: Boolean(settings.logoKey) });
  }, afterPublished: async (update) => {
    const results = await Promise.allSettled([
      notificationOrigin(bindings).then(origin => deliveries.dispatchEvent(update.id, origin)),
      channels.dispatchPending(),
      responders.dispatchPublication(update.id).catch(() => { console.error("Lamp could not finish a responder note receipt."); }),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  } });
  const briefs = createBriefService(createBriefRepository(bindings.DB));
  // INCIDENT-010 and NOTIFY-006: one operator email per committed time and kind, sent by the scheduled trigger.
  const updateReminders = createUpdateReminders(bindings.DB, extensions.updateDuePolicy, async ({ kind, incidentId, reference, title, updateId, nextUpdateAt, recipients, draftId }) => {
    const committed = await formatPreviewTimestamp(nextUpdateAt);
    const link = `${authOrigin(bindings)}/app/incidents/${incidentId}${draftId ? "#prepared-draft" : ""}`;
    await deliveries.queueOperatorAlert(kind === "due-soon"
      ? { eventId: `incident-due-soon/${updateId}`, recipients, title: `Lamp update due at ${committed}: ${reference}`, text: `${reference} ${title}: the next update you committed to customers is due at ${committed}. Nothing reaches customers until an operator publishes it. Write it here: ${link}` }
      : kind === "escalation" ? { eventId: `incident-escalation/${updateId}`, title: `Lamp communication escalation: ${reference}`, text: `${reference} ${title} is at least ${extensions.incidentEscalationPolicy.overdueMinutes()} minutes past its next-update commitment of ${committed}. Every active operator can publish until TEAM-004 roles ship. Write the update here: ${link}` }
      : { eventId: `incident-overdue/${updateId}`, recipients, title: `Lamp incident is overdue for an update: ${reference}`, text: `${reference} ${title} passed its next-update commitment of ${committed} with no newer update. The public page still shows that time. Write the update here: ${link}` });
  }, extensions.incidentEscalationPolicy, createPromiseDraftPreparer(createPromiseDraftRepository(bindings.DB), briefs));
  const maintenance = createMaintenanceService(createMaintenanceRepository(bindings.DB), components, publicSnapshots.rebuild, {
    forMaintenanceNotice: async (input) => [
      ...notificationPublicationStatements(bindings.DB, { eventId: input.eventId, eventType: "maintenance-notice", maintenanceId: input.maintenanceId, componentIds: input.componentIds, channels: ["email", "webhook"], queuedAt: input.queuedAt, recipientScope: input.recipientScope, previousEventIds: input.previousEventIds }),
      ...channels.maintenanceStatements(input),
    ],
  }, extensions.maintenanceRemindersPolicy,
  async ({ maintenanceId, endsAt }) => deliveries.queueOperatorAlert({ eventId: `maintenance-overrun/${maintenanceId}/${endsAt}`, title: "Lamp maintenance is running longer than planned", text: `Maintenance ${maintenanceId} is still in progress more than fifteen minutes after its scheduled end.` }),
  extensions.events,
  async ({ maintenanceId, startsAt }) => deliveries.queueOperatorAlert({ eventId: `maintenance-start-due/${maintenanceId}/${new Date(startsAt).toISOString()}`, title: "Lamp maintenance start is due", text: `Maintenance ${maintenanceId} has reached its planned start and has auto-start off. An operator must start it in Maintenance.` }));
  const subscribers = createSubscribersService(createSubscriberRepository(bindings.DB), {
    onLimitAlert: alert=>deliveries.queueOperatorAlert(alert),
    mail,
    pageName: configuredPageName,
    fromAddress: configuredFromAddress,
    tokenSecret: bindings.SUBSCRIBER_TOKEN_SECRET,
    confirmationPolicy: extensions.subscriberConfirmationPolicy,
    events: {
      subscriberConfirmed: extensions.events.subscriberConfirmed,
      subscriberDeactivated: extensions.events.subscriberDeactivated,
    },
  });
  const teamsSubscriptions = createTeamsSubscriptionsService(bindings.DB, {
    webhookSecret: bindings.WEBHOOK_SIGNING_SECRET, tokenSecret: bindings.SUBSCRIBER_TOKEN_SECRET,
    pageName: configuredPageName, limitsChanged: () => subscribers.checkLimits(),
    unavailable: outboundUnavailable(bindings, "Teams subscriptions"),
  });
  const availabilityReports = createAvailabilityReportService(createAvailabilityReportRepository(bindings.DB), extensions.publicSnapshotPolicies);
  const communicationPerformance = createCommunicationPerformanceService(createCommunicationPerformanceRepository(bindings.DB), extensions.postmortemDuePolicy);
  const reports = createReportsService(createReportRepository(bindings.DB), publicSnapshots.rebuild, extensions.postmortemDuePolicy, {
    forIncidentReport: async (input) => notificationPublicationStatements(bindings.DB, { eventId: input.eventId, eventType: "incident-report", incidentReportId: input.eventId, componentIds: input.componentIds, channels: input.channels, queuedAt: input.queuedAt }),
  }, briefs, async ({ incidentId, reference, title, week }) => deliveries.queueOperatorAlert({
    eventId: `report-reminder/${incidentId}/${week}`,
    recipients: await createCommunicationOwnerRepository(bindings.DB).recipients(incidentId),
    title: `Lamp report follow-up: ${reference}`,
    text: `${reference} ${title} is owing a post-incident report. Write or waive it here: ${authOrigin(bindings)}/app/incidents/${incidentId}#post-incident-report`,
  }));
  const intake = createIntakeService(createIntakeRepository(bindings.DB), extensions.alertIntakePolicy, async (incidentId) => deliveries.queueOperatorAlert({ eventId: `intake-draft/${incidentId}`, title: "Lamp alert intake created an incident draft", text: `A configured alert source created draft incident ${incidentId}; review and publish it if customer communication is needed.` }), extensions.events, { webhookSecret: bindings.WEBHOOK_SIGNING_SECRET });
  const aiValues = [bindings.AI_PROVIDER_URL, bindings.AI_PROVIDER_API_KEY, bindings.AI_PROVIDER_MODEL];
  const configuredAiValues = aiValues.filter((value) => Boolean(value)).length;
  if (configuredAiValues > 0 && configuredAiValues !== aiValues.length) {
    throw new Error("Lamp AI requires AI_PROVIDER_URL, AI_PROVIDER_API_KEY, and AI_PROVIDER_MODEL together.");
  }
  if (extensions.adapters["ai.provider.v1"] && configuredAiValues > 0) {
    throw new Error("Lamp cannot configure AI_PROVIDER_* values alongside the ai.provider.v1 extension adapter.");
  }
  const configuredAi = extensions.adapters["ai.provider.v1"] ?? (configuredAiValues === aiValues.length
    ? createOpenAiCompatibleProvider({ endpoint: bindings.AI_PROVIDER_URL!, apiKey: bindings.AI_PROVIDER_API_KEY!, model: bindings.AI_PROVIDER_MODEL! })
    : null);
  // A demo visitor sees suggestions without the provider being called (Base demoEffect).
  const aiProvider = bindings.RER_DEMO === '1' ? createDemoAiProvider(configuredAi) : configuredAi;
  const aiUnavailable = outboundUnavailable(bindings, "AI suggestions");
  const ai = createAiService(briefs, aiUnavailable ? null : aiProvider, aiUnavailable);
  const overview = createOverviewService(components, incidents, maintenance, createLiveStatusService(createOverviewRepository(bindings.DB), pageSettings, {
    // An operator request reads the page host at its own scheme and port, as
    // the Settings link to the public page does; Cron uses the deployment's.
    publicOrigin: async () => {
      if (!(execution instanceof Request)) return notificationOrigin(bindings);
      const origin = new URL(execution.url);
      origin.hostname = bindings.LAMP_PAGE_HOST;
      return origin.origin;
    },
    publishedAt: () => publicSnapshots.publishedAt(),
    // A demo's mail transport is local, but its sender reads as a configured one's.
    sender: { local: local && bindings.RER_DEMO !== '1', demo: bindings.RER_DEMO === '1', provider: bindings.MAIL_PROVIDER || "resend", apiKey: bindings.MAIL_PROVIDER_API_KEY, mailgunRegion: bindings.MAILGUN_REGION, sesRegion: bindings.SES_REGION, postmarkAccountApiKey: bindings.POSTMARK_ACCOUNT_API_KEY, mail },
  }));

  const devSiteOrigin = import.meta.env?.DEV && bindings.LAMP_DEV_SITE_ORIGIN?.startsWith("http://127.0.0.1:") ? bindings.LAMP_DEV_SITE_ORIGIN : undefined;
  const readingUnavailable = outboundUnavailable(bindings, "Reading your website");
  const website = createWebsiteService(createWebsiteRepository(bindings.DB), {
    read: websiteReader(devSiteOrigin),
    readStatusPage: statusPageReader(devSiteOrigin),
    unavailable: readingUnavailable ? "Lamp can't read websites on Managed hosting yet. Fill in the rest below." : null,
  });

  // Imported subscribers each get one confirmation invite; past incidents notify no one.
  const importPublicOrigin = async () => execution instanceof Request ? publicPageOrigin(execution.url, bindings.LAMP_PAGE_HOST) : notificationOrigin(bindings);
  const statuspageImport = createStatuspageImportService(bindings.DB, {
    publicOrigin: importPublicOrigin,
    inviteSubscriber: async (subscriberId, claimSend) => subscribers.inviteImported(subscriberId, await importPublicOrigin(), (await pageSettings.get())?.pageName ?? "This status page", claimSend),
    publicDataChanged: () => publicSnapshots.rebuild(true),
  }, {
    apiOrigin: import.meta.env?.DEV && bindings.LAMP_DEV_STATUSPAGE_ORIGIN?.startsWith("http://127.0.0.1:") ? bindings.LAMP_DEV_STATUSPAGE_ORIGIN : undefined,
    // The status page setup found, read keyless with the website reader's guard, where reading websites is allowed.
    capturePublicFeeds: readingUnavailable ? undefined : statusFeedCapture(devSiteOrigin),
  });

  // Subscribers a restore could not vouch for get the same one confirmation as a move-in import's.
  const pageExport = createPageExportService(createPageExportRepository(bindings.DB), blobs, {
    integritySecret: bindings.SUBSCRIBER_TOKEN_SECRET,
    mailIdentityEditable: bindings.MAIL_PROVIDER !== "rer",
    onPublicDataChanged: () => publicSnapshots.rebuild(true),
    sendConfirmation: async (subscriberId) => subscribers.inviteImported(subscriberId, await importPublicOrigin(), (await pageSettings.get())?.pageName ?? "This status page", async () => true),
  });

  const chatDesk = createChatDeskService(bindings, incidents, components, async () => { const settings = await pageSettings.get(); if (!settings) throw new Error("Page settings are not configured."); return { blockedTerms: settings.wordingBlockedTerms, friendlyLength: settings.wordingFriendlyLength }; });
  return { teamsSubscriptions, chatDesk, auth, operators, availabilityReports, communicationPerformance, incidentImpact, pageSettings, pageExport, components, componentCatalogue, incidents, maintenance, subscribers, deliveries, reports, intake, briefs, ai, overview, website, updateReminders, publicSnapshots, statuspageImport, channels };
}

export type AppServices = ReturnType<typeof createAppServices>;
