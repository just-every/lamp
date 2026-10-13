import { randomBytes } from 'node:crypto';

// The per-checkout key `rer setup` writes. A development runtime started with it
// answers the outbox only to a request holding it, as rer's own commands do.
export const devKey = randomBytes(32).toString('base64url');
export const devKeyHeaders = { 'x-rer-dev-key': devKey };
