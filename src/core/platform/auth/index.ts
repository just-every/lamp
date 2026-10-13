import { AuthError, createOperatorAuth, defaultRolePolicy, normalizeEmail } from '@runeditrun/rer/modules/operator-auth';
import type { AppBindings } from '../../app/types';
import type { MailSender } from '../mail';
import { createOperatorRepository } from '../../features/operators/repository';
import { authConfig } from './config';

export function createLampAuth(env: AppBindings, mail?: MailSender) {
  const repository = createOperatorRepository(env.DB);
  const config = authConfig(env);
  const auth = createOperatorAuth({ db: env.DB, config,
    clientIp: request => config.local ? 'loopback' : request.headers.get('CF-Connecting-IP') ?? '',
    rolePolicy: async input => {
      if (!defaultRolePolicy(input)) return false;
      if (input.action === 'operators:reactivate' && input.target && input.target.email === `deleted-${input.target.id.toLowerCase()}@operator.invalid`) return false;
      if (input.action === 'operators:invite' || input.action === 'operators:role') {
        // Lamp operators are equal. The Base owner role enforces recovery guards,
        // it does not introduce product permissions.
        if (input.role !== 'owner') return false;
      }
      if (input.target && ['operators:deactivate', 'operators:role'].includes(input.action)) {
        if (await repository.isSetupOperator(input.target.id) && input.actor.id !== input.target.id) return false;
      }
      return true;
    },
    ...(mail?.configured ? { mailSender: { async send(message) {
      await mail.send({ from: message.from, to: message.to[0], subject: message.subject, text: message.text,
        html: message.html, headers: message.headers, idempotencyKey: `operator-auth/${message.deliveryId}` });
      return { status: 'accepted' as const, provider: 'lamp-mail', providerMessageId: null };
    } } } : {}),
  });
  return Object.freeze({
    ...auth,
    async invite(request: Request, input: Parameters<typeof auth.invite>[1]) {
      // The retained anonymous address is an attribution marker. Neither Base's
      // invitation door nor Lamp's Settings door may reopen it as an identity.
      if (normalizeEmail(input.email).endsWith('@operator.invalid')) throw new AuthError('email_not_allowed', 403);
      return auth.invite(request, input);
    },
  });
}
