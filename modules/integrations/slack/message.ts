/** Deliberately small Block Kit message surface: text sections, no interactive effects. */
export interface SlackMessage {
  text: string;
  blocks: { type: 'section'; text: { type: 'plain_text'; text: string; emoji: boolean } }[];
  mrkdwn: false;
  unfurl_links: false;
  unfurl_media: false;
}
export interface SlackEventData { title: string; detail: string }
export type SlackTemplate<Data = SlackEventData> = (data: Data) => { summary: string; sections: string[] };
export type SlackTemplates<Data = SlackEventData> = Readonly<Record<string, SlackTemplate<Data>>>;

function incidentTemplate(label: string): SlackTemplate {
  return ({ title, detail }) => {
    text(title, 2800); text(detail, 3000);
    return { summary: `${label}: ${title}`, sections: [`${label}: ${title}`, detail] };
  };
}
export const slackEventTemplates: SlackTemplates = Object.freeze({
  'incident.opened': incidentTemplate('Incident opened'),
  'incident.updated': incidentTemplate('Incident updated'),
  'incident.resolved': incidentTemplate('Incident resolved'),
});

/** Slack's documented message-formatting escape: `&` first, then `<` and `>`. Idempotence is
 * deliberately absent: callers pass raw text and must never pre-escape. */
export function escapeSlackText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || new TextDecoder().decode(new TextEncoder().encode(value)) !== value) throw new Error('Invalid Slack text');
}
/** Defence in depth: a validated message never carries a raw control character, so a hand-built
 * message cannot smuggle a mention, channel/user reference or `<url|label>` link. */
function escaped(value: string) {
  if (/[<>]/.test(value)) throw new Error('Unescaped Slack text');
}
function exactKeys(value: object, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unsupported Slack message field');
}
export function validateSlackMessage(value: unknown, channel?: string): asserts value is SlackMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Slack message');
  const m = value as Record<string, unknown>;
  exactKeys(m, ['text', 'blocks', 'mrkdwn', 'unfurl_links', 'unfurl_media', ...(channel === undefined ? [] : ['channel'])]);
  text(m.text, 4000); escaped(m.text);
  if (m.mrkdwn !== false || m.unfurl_links !== false || m.unfurl_media !== false || (channel !== undefined && m.channel !== channel)) throw new Error('Invalid Slack message options');
  if (!Array.isArray(m.blocks) || m.blocks.length < 1 || m.blocks.length > 50) throw new Error('Invalid Slack blocks');
  for (const block of m.blocks) {
    if (!block || typeof block !== 'object' || block.type !== 'section' || !block.text || typeof block.text !== 'object') throw new Error('Invalid Slack section');
    exactKeys(block, ['type', 'text']); exactKeys(block.text, ['type', 'text', 'emoji']);
    if (block.text.type !== 'plain_text' || typeof block.text.emoji !== 'boolean') throw new Error('Invalid Slack text object');
    text(block.text.text, 3000); escaped(block.text.text);
  }
}
export function renderSlackEvent<Data>(event: string, data: Data, templates: SlackTemplates<Data>): SlackMessage {
  if (!Object.hasOwn(templates, event) || typeof templates[event] !== 'function') throw new Error('Unknown Slack event template');
  let result: ReturnType<SlackTemplate<Data>>;
  try { result = templates[event]!(data); } catch { throw new Error('Slack template failed'); }
  if (!result || !Array.isArray(result.sections)) throw new Error('Invalid Slack template output');
  // Everything a template returns is escaped here, after composition, so no template can leak a
  // raw `<`/`>` and none needs to (or may) escape its own output.
  if (typeof result.summary !== 'string' || result.sections.some(section => typeof section !== 'string')) throw new Error('Invalid Slack template output');
  const message: SlackMessage = {
    text: escapeSlackText(result.summary),
    blocks: result.sections.map(section => ({ type: 'section', text: { type: 'plain_text', text: escapeSlackText(section), emoji: true } })),
    mrkdwn: false, unfurl_links: false, unfurl_media: false,
  };
  validateSlackMessage(message);
  return message;
}
export function assertSlackChannel(channel: unknown): asserts channel is string {
  if (typeof channel !== 'string' || !/^[CGD][A-Z0-9]{1,79}$/.test(channel)) throw new Error('Invalid Slack channel ID');
}
export function serializeSlackMessage(message: SlackMessage, channel?: string): string {
  validateSlackMessage(message);
  if (channel !== undefined) assertSlackChannel(channel);
  return JSON.stringify(channel === undefined ? message : { ...message, channel });
}
