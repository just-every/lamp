import { escapeSlackText, validateSlackMessage } from "../../../../modules/integrations/slack/message.ts";
import { renderUpdateSlack, tokenizeUpdateLinks } from "../../shared/update-links";

type InlineText = { type: "text"; text: string } | { type: "link"; url: string; text: string };
export interface LampSlackMessage {
  text: string;
  blocks: Array<{ type: "rich_text"; elements: Array<{ type: "rich_text_section"; elements: InlineText[] }> }>;
  mrkdwn: false;
  parse: "none";
  unfurl_links: false;
  unfurl_media: false;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Slack message object.");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error("Unsupported Slack message fields.");
}

function text(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > maximum || new TextDecoder().decode(new TextEncoder().encode(value)) !== value) throw new Error("Invalid Slack text.");
}

/** A deliberately narrow native rich_text shape: literal text and HTTPS links only. */
export function validateLampSlackMessage(value: unknown): asserts value is LampSlackMessage {
  const message = record(value);
  exactKeys(message, ["text", "blocks", "mrkdwn", "parse", "unfurl_links", "unfurl_media"]);
  text(message.text, 4000);
  const prose = message.text.replace(/<([^<>]+)>/gu, (_match, link: string) => {
    const url = link.replaceAll("&amp;", "&");
    const tokens = tokenizeUpdateLinks(url);
    if (tokens.length !== 1 || tokens[0]?.kind !== "https" || tokens[0].href !== url) throw new Error("Invalid Slack notification link.");
    return "";
  });
  if (/[<>]/u.test(prose) || message.mrkdwn !== false || message.parse !== "none" || message.unfurl_links !== false || message.unfurl_media !== false) throw new Error("Invalid Slack message options.");
  if (!Array.isArray(message.blocks) || message.blocks.length < 1 || message.blocks.length > 50) throw new Error("Invalid Slack blocks.");
  for (const candidate of message.blocks) {
    const block = record(candidate);
    exactKeys(block, ["type", "elements"]);
    if (block.type !== "rich_text" || !Array.isArray(block.elements) || block.elements.length !== 1) throw new Error("Invalid Slack rich text block.");
    const section = record(block.elements[0]);
    exactKeys(section, ["type", "elements"]);
    if (section.type !== "rich_text_section" || !Array.isArray(section.elements) || !section.elements.length) throw new Error("Invalid Slack rich text section.");
    let length = 0;
    for (const candidate of section.elements) {
      const element = record(candidate);
      if (element.type === "text") {
        exactKeys(element, ["type", "text"]);
      } else if (element.type === "link") {
        exactKeys(element, ["type", "url", "text"]);
        text(element.url, 3000);
        const tokens = tokenizeUpdateLinks(element.url);
        if (tokens.length !== 1 || tokens[0]?.kind !== "https" || tokens[0].href !== element.url || element.text !== element.url) throw new Error("Invalid Slack HTTPS link.");
      } else throw new Error("Unsupported Slack rich text element.");
      text(element.text, 3000);
      length += element.text.length;
    }
    if (length > 3000) throw new Error("Slack section exceeds its text limit.");
  }
}

export function renderLampSlackMessage(summary: string, fields: string[]): LampSlackMessage {
  const sections: InlineText[][] = [];
  let length = 0;
  const append = (element: InlineText) => {
    if (!sections.length || length + element.text.length > 2800) { sections.push([]); length = 0; }
    sections[sections.length - 1]!.push(element);
    length += element.text.length;
  };
  for (const field of fields.filter(Boolean)) {
    if (sections.length) append({ type: "text", text: "\n\n" });
    // Tokenize each original field separately: a literal tag in one field
    // cannot consume a later field's URL while sections are being packed.
    for (const token of tokenizeUpdateLinks(field)) {
      if (token.kind === "https") {
        text(token.href, 2800);
        append({ type: "link", url: token.href, text: token.text });
      } else {
        let part = "";
        for (const character of token.text) {
          if (part.length + character.length > 2800) { append({ type: "text", text: part }); part = ""; }
          part += character;
        }
        if (part) append({ type: "text", text: part });
      }
    }
  }
  // Slack uses top-level text for notifications and accessibility. Explicit
  // <url> links accompany the summary; blocks retain the complete literal text.
  let notification = escapeSlackText(summary);
  const links = new Set(fields.flatMap(field => tokenizeUpdateLinks(field).flatMap(token => token.kind === "https" ? [token.href] : [])));
  for (const link of links) {
    const addition = `\n${renderUpdateSlack(link)}`;
    if (notification.length + addition.length <= 4000) notification += addition;
  }
  const message: LampSlackMessage = {
    text: notification,
    blocks: sections.map(elements => ({ type: "rich_text", elements: [{ type: "rich_text_section", elements }] })),
    mrkdwn: false, parse: "none", unfurl_links: false, unfurl_media: false,
  };
  validateLampSlackMessage(message);
  return message;
}

/** Retained delivery envelopes use Base's existing plain_text validator unchanged. */
export function validateSlackEnvelope(body: string) {
  const value: unknown = JSON.parse(body);
  const message = record(value);
  if (Array.isArray(message.blocks) && message.blocks.some(block => record(block).type === "rich_text")) validateLampSlackMessage(value);
  else validateSlackMessage(value);
}
