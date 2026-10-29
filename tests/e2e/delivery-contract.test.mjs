import { incidentSubscriptionApiFlow } from './helpers/incident-subscription-api-flow.mjs';
import { incidentFollowFlow } from './helpers/incident-follow-flow.mjs';
import { test } from 'node:test';
import { createServer } from 'vite';
import { subscriberAddFlow } from './helpers/subscriber-add-flow.mjs';
import { subscriberPreferencesFlow } from './helpers/subscriber-preferences-flow.mjs';
import { subscriberCsvFlow } from './helpers/subscriber-csv-flow.mjs';
import { smsSubscriberFlow } from './helpers/sms-subscriber-flow.mjs';
import { statuspageWebhookFlow } from './helpers/statuspage-webhook-flow.mjs';
import { mailFailoverFlow } from './helpers/mail-failover-flow.mjs';
import { mailSettingsBrowserFlow } from './helpers/mail-settings-browser-flow.mjs';
import { webhookAtMostOnceFlow } from './helpers/webhook-at-most-once-flow.mjs';

// Consent, publication, delivery and erasure are exercised through the ordinary
// operator/public HTTP doors and captured provider transports. No repository or
// delivery-service method is used as a substitute for a user action.
test('SUB-019 SUB-001 SUB-002 SUB-003 SUB-004 SUB-005 SUB-006 SUB-007 SUB-008 SUB-009 SUB-010 SUB-011 SUB-012 SUB-013 SUB-016 SUB-017 SUB-018 SUB-020 PAGE-013 HIST-007 TEAM-003 TEAM-004 UPDATE-008 — Subscriber consent, selected publication, channel delivery, export and erasure', { timeout: 600_000 }, async () => {
  await subscriberAddFlow();
  await subscriberPreferencesFlow();
  await subscriberCsvFlow();
  await statuspageWebhookFlow();
  await smsSubscriberFlow();
  await webhookAtMostOnceFlow();
});

test('NOTIFY-013 NOTIFY-002 NOTIFY-003 NOTIFY-004 NOTIFY-005 NOTIFY-007 NOTIFY-008 NOTIFY-010 — Owner-selected provider fallback preserves frozen notifications and reconciles delivery receipts', { timeout: 300_000 }, async t => {
  const vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true } });
  try {
    for (const secondaryProvider of ['mailgun', 'ses', 'postmark']) await mailFailoverFlow({ t, vite, secondaryProvider });
  } finally { await vite.close(); }
  await mailSettingsBrowserFlow(t);
});


test('Scoped incident subscriptions — native and Statuspage API consent, private reads and revoked writes', {timeout:600_000}, async()=>{
  await incidentFollowFlow();
  await incidentSubscriptionApiFlow();
});
