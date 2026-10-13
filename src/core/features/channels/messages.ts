import type { SlackTemplates } from "../../../../modules/integrations/slack/message.ts";

export interface ChannelPostData { reference: string; title: string; lifecycle: string; customerImpact: string; affectedAudience: string; url: string }

/** One rendering of a published update for chat channels, from its public fields only. */
export const slackTemplates: SlackTemplates<ChannelPostData> = Object.freeze({
  "incident.update": (data: ChannelPostData) => ({
    summary: `${data.reference} ${data.lifecycle}: ${data.title}`.slice(0, 2800),
    sections: [`${data.reference} · ${data.lifecycle}: ${data.title}`.slice(0, 2800), `${data.customerImpact}\n${data.affectedAudience}`.slice(0, 2900), data.url],
  }),
});

export function teamsCard(data: ChannelPostData): string {
  return JSON.stringify({
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
        body: [
          { type: "TextBlock", text: `${data.reference} · ${data.lifecycle}`, weight: "Bolder", wrap: true },
          { type: "TextBlock", text: data.title, size: "Medium", wrap: true },
          { type: "TextBlock", text: data.customerImpact, wrap: true },
          { type: "TextBlock", text: data.affectedAudience, isSubtle: true, wrap: true },
        ],
        actions: [{ type: "Action.OpenUrl", title: "Open the status page", url: data.url }],
      },
    }],
  });
}
