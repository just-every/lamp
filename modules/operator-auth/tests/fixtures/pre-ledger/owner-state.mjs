// Public, test-only values matched to the static HMACs in rows.sql.
export const NOW = 1900000000000;
export const SECRET = ['pre', 'ledger', 'fixture', 'only', 'session', 'secret', 'never', 'use', 'in', 'production'].join('-');
export const SETUP = ['pre', 'ledger', 'fixture', 'only', 'setup', 'secret', 'never', 'use', 'in', 'production'].join('-');
export const credentials = Object.freeze({
  "ownerSession": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "activeSession": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "inactiveSession": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "activeLink": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "inactiveLink": "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
  "pendingLink": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
  "expiredLink": "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "cancelledLink": "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
  "guardedLink": "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"
});
export const oldCookie = name => `__Host-operator_session=${credentials[`${name}Session`]}`;
