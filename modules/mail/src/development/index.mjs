import { MailValidationError, fail } from '../core/errors.mjs';
import { validateConfig, validateMessage } from '../core/validation.mjs';
import { sendResult } from '../core/transport.mjs';

export { createD1DevelopmentOutbox } from './outbox.mjs';
export { createDevelopmentOutboxHandler } from './viewer.mjs';

function validate(operation, errorCode) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MailValidationError) throw error;
    fail(errorCode);
  }
}

/** Store one explicitly selected development message without contacting a provider. */
export async function sendDevelopment(config, message, dependencies = {}) {
  validate(() => validateConfig(config, dependencies), 'invalid_config');
  if (validate(() => config.provider, 'invalid_config') !== 'development') fail('development_provider_required');

  validate(() => validateMessage(message, 'development'), 'invalid_message');
  if (validate(() => message.unsubscribe, 'invalid_message') !== undefined) fail('unsubscribe_not_assembled');

  const snapshot = validate(() => structuredClone(message), 'invalid_message');
  validate(() => validateMessage(snapshot, 'development'), 'invalid_message');

  try {
    await dependencies.outbox.put(snapshot);
  } catch {
    fail('development_outbox_failed');
  }

  return sendResult('development', 'development', null);
}
