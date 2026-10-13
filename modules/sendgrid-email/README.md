# SendGrid email transport (deprecated)

This module is deprecated. Its only job now is to keep the former import path working:
`src/sender.ts` re-exports the same API from [the mail module](../mail/README.md), where the single
SendGrid transport lives. Nothing here builds a request or contacts SendGrid.

## Switch the import

Seeds that copy the `sendgrid-email` module stop copying it and copy [the mail module](../mail/README.md) instead (see
[Adopting](../mail/README.md#adopting)). Then change:

```ts
// before
import { sendSendGrid, serializeSendGridMessage, SendGridSendError } from './modules/sendgrid-email/sender'
// after
import { sendSendGrid, serializeSendGridMessage, SendGridSendError } from './modules/mail/src/sendgrid-email/index.mjs'
```

`SendGridMessage` is exported by the same file as a type. The exports, results and errors keep their shape.
New code should call `createMailSender({ provider: 'sendgrid', ... })` from `modules/mail/index.mjs`.
What changed for the former API, including the stricter shared validation and the attachment
member order, is in [the former sendgrid-email API](../mail/README.md#the-former-sendgrid-email-api).

## Tests

`tests/sender.test.ts` is the former module's own suite, unchanged, now running against the re-export.
`tests/equivalence.test.ts` sends the same messages through the former path, the compat path and the
`createMailSender` facade to a fake SendGrid API and requires identical requests and identical outcome
classification. `tests/layout.test.ts` keeps the mail README's Adopting file lists exact. Run
`pnpm verify:modules` from the Base repository.

## Removal

Nothing in Base imports this module. Delete the folder once the seeds that copied it have switched.
