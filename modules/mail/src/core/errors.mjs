/** Input values never appear in validation diagnostics. */
export class MailValidationError extends Error {
  constructor(code = 'invalid_mail_input') {
    super('Mail input is invalid; check the error code and module contract.');
    this.name = 'MailValidationError';
    this.code = typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'invalid_mail_input';
  }
}
export function fail(code) { throw new MailValidationError(code); }
