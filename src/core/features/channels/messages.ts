import { renderNotificationUpdate } from "../../shared/update-renderer";
import type { IncidentImpact } from "../../shared/incident-impact";
import { formatTime } from "../public-snapshot/format";
import { renderUpdateTeams } from "../../shared/update-links";
import type { IncidentLifecycle } from "../../shared/domain";
import type { PublishedIncidentComponentChange } from "../../shared/incident-component-changes";
import { renderLampSlackMessage } from "./slack-message";

export interface ChannelPostData {
  incidentImpact: IncidentImpact | null;
  reference: string;
  title: string;
  lifecycle: IncidentLifecycle;
  customerImpact: string;
  affectedAudience: string;
  whatStillWorks: string;
  details: string;
  nextUpdateAt: string | null;
  timezone: string;
  componentChanges?: PublishedIncidentComponentChange[];
  url: string;
}

function channelUpdate(data: ChannelPostData) {
  return renderNotificationUpdate({
    incidentImpact: data.incidentImpact,
    incidentReference: data.reference, incidentTitle: data.title, lifecycle: data.lifecycle,
    affectedAudience: data.affectedAudience, customerImpact: data.customerImpact,
    whatStillWorks: data.whatStillWorks, details: data.details, nextUpdateAt: data.nextUpdateAt,
    nextUpdateDisplay: data.nextUpdateAt ? formatTime(data.nextUpdateAt, data.timezone) : null,
    componentChanges: data.componentChanges,
  });
}

/** Every populated field and immutable component change uses the shared renderer. */
export function renderChannelSlack(data: ChannelPostData) {
  const update = channelUpdate(data);
  return renderLampSlackMessage(`${data.reference} ${data.lifecycle}: ${data.title}`, [
    update.public.heading, `Status: ${update.public.lifecycle}`,
    ...update.public.fields.map(field => `${field.label}: ${field.value}`), data.url,
  ]);
}

export function teamsCard(data: ChannelPostData): string {
  const update = channelUpdate(data);
  return JSON.stringify({
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
        body: [
          { type: "TextBlock", text: renderUpdateTeams(`${data.reference} · ${data.lifecycle}`), weight: "Bolder", wrap: true },
          { type: "TextBlock", text: renderUpdateTeams(data.title), size: "Medium", wrap: true },
          ...update.public.fields.map(field => ({ type: "TextBlock", text: renderUpdateTeams(`${field.label}: ${field.value}`), wrap: true })),
        ],
        actions: [{ type: "Action.OpenUrl", title: "Open the status page", url: data.url }],
      },
    }],
  });
}

export function teamsTestCard(text: string): string {
  return JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text: renderUpdateTeams(text), wrap: true }],
  } }] });
}
