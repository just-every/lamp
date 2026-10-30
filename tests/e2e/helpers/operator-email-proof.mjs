import assert from "node:assert/strict";
import { eventuallyFollowUp } from "./follow-ups-runtime.mjs";

// Completion is a barrier only. Expected recipients and event identity come
// from the journey's operator actions, never the application's stored envelope.
export async function settleOperatorEmails(fixture) {
  await eventuallyFollowUp(async () => (await fixture.db.prepare(
    "SELECT count(*) AS pending FROM notification_outbox WHERE kind='operator-alert' AND completed_at IS NULL",
  ).first()).pending, count => count === 0, "operator email work finishes before counting provider requests");
}

export function assertOneOperatorEmail(fixture, recipients, subject, eventId) {
  const messages = fixture.messages.filter(message => subject.test(message.subject) && message.text.includes(eventId));
  assert.equal(messages.length, recipients.length, `one email per operator for ${eventId}`);
  for (const recipient of recipients) {
    const addressed = messages.filter(message => message.to.includes(recipient));
    assert.equal(addressed.length, 1, `${recipient} receives ${eventId} exactly once`);
    assert.deepEqual(addressed[0].to, [recipient], "each operator receives a private email");
  }
}
