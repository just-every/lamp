// Deprecated path. The SendGrid transport lives once, in modules/mail; this file only
// keeps the former import path working. New code uses createMailSender from modules/mail.
export type { SendGridMessage } from '../../mail/src/sendgrid-email/index.mjs'
export { SendGridSendError, serializeSendGridMessage, sendSendGrid } from '../../mail/src/sendgrid-email/index.mjs'
