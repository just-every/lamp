import type { Outcome, WireResponse } from '../core/index.ts';

// Only fixed documented names may be logged. Never interpolate arbitrary provider data.
const webhookRejections = new Set([
  'action_prohibited', 'channel_is_archived', 'invalid_payload', 'invalid_token',
  'no_active_hooks', 'no_service', 'no_service_id', 'no_team', 'no_text',
  'posting_to_general_channel_denied', 'team_disabled', 'too_many_attachments',
  'user_not_found', 'channel_not_found',
]);
const botRejections = new Set([
  'access_denied', 'accesslimited', 'account_inactive', 'agent_prompt_display_not_allowed',
  'app_access_restricted', 'as_user_not_supported', 'attachment_payload_limit_exceeded',
  'cannot_reply_to_message', 'channel_not_found', 'deprecated_endpoint',
  'draft_already_deleted', 'draft_already_sent', 'draft_has_conflict', 'draft_not_found',
  'duplicate_channel_not_found', 'duplicate_message_not_found', 'ekm_access_denied',
  'enterprise_is_restricted', 'invalid_arg_name', 'invalid_arguments', 'invalid_array_arg',
  'invalid_auth', 'invalid_blocks', 'invalid_blocks_format', 'invalid_charset',
  'invalid_form_data', 'invalid_metadata_format', 'invalid_metadata_schema', 'invalid_post_type',
  'is_archived', 'markdown_text_conflict', 'message_limit_exceeded', 'messages_tab_disabled',
  'metadata_must_be_sent_from_app', 'metadata_too_large', 'method_deprecated', 'missing_file_data',
  'missing_post_type', 'missing_scope', 'msg_blocks_too_long', 'no_permission', 'no_text',
  'not_allowed_token_type', 'not_authed', 'not_in_channel', 'request_timeout',
  'restricted_action', 'restricted_action_non_threadable_channel', 'restricted_action_read_only_channel',
  'restricted_action_thread_locked', 'restricted_action_thread_only_channel', 'send_on_behalf_not_allowed',
  'slack_connect_canvas_sharing_blocked', 'slack_connect_file_link_sharing_blocked',
  'slack_connect_lists_sharing_blocked', 'team_access_not_granted', 'team_not_found',
  'token_expired', 'token_revoked', 'too_many_attachments', 'too_many_contact_cards',
  'two_factor_setup_required', 'user_not_found',
]);
function rateLimited(response: WireResponse): Outcome {
  const entries = Object.entries(response.headers).filter(([name]) => name.toLowerCase() === 'retry-after');
  const value = entries.length === 1 ? entries[0]![1].trim() : '';
  // Slack specifies whole seconds. Missing/ambiguous headers require intervention;
  // inventing an earlier retry time would violate the provider's cooldown.
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value) * 1000)) return { kind: 'rejected', code: 'slack_rate_limit_invalid_delay', status: response.status };
  return { kind: 'retryable', code: 'slack_rate_limited', status: response.status, retryAfterMs: Number(value) * 1000 };
}
export function classifySlackIncomingWebhook(response: WireResponse): Outcome {
  const { status, body } = response;
  if (status === 429) return rateLimited(response);
  if (status === 200 && body === 'ok') return { kind: 'accepted', code: 'slack_webhook_accepted', status };
  if (status >= 400 && status < 500 && webhookRejections.has(body)) return { kind: 'rejected', code: `slack_${body}`, status };
  return { kind: 'uncertain', code: 'slack_webhook_response_unknown', status };
}
export function classifySlackBot(response: WireResponse): Outcome {
  const { status } = response;
  if (status === 429) return rateLimited(response);
  // A gateway error, redirect or server failure does not establish non-delivery.
  if (status !== 200) return { kind: 'uncertain', code: 'slack_bot_http_unknown', status };
  let value: unknown;
  try { value = JSON.parse(response.body); } catch { return { kind: 'uncertain', code: 'slack_bot_invalid_response', status }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'uncertain', code: 'slack_bot_invalid_response', status };
  const body = value as Record<string, unknown>;
  if (body.ok === true && body.error === undefined) return { kind: 'accepted', code: 'slack_bot_accepted', status };
  if (body.ok === false && typeof body.error === 'string') {
    if (body.error === 'rate_limited' || body.error === 'ratelimited') return rateLimited(response);
    if (botRejections.has(body.error)) return { kind: 'rejected', code: `slack_${body.error}`, status };
    // Slack explicitly warns that internal_error/fatal_error can follow a partial effect.
    if (body.error === 'internal_error' || body.error === 'fatal_error') return { kind: 'uncertain', code: `slack_${body.error}`, status };
  }
  return { kind: 'uncertain', code: 'slack_bot_response_unknown', status };
}
