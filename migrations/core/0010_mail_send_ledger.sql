-- SendGrid has no request-idempotency primitive. Claim before sending so an
-- ambiguous request can be reconciled by a signed receipt without resending.
CREATE TABLE mail_send_ledger (
  id TEXT PRIMARY KEY,
  envelope_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'uncertain', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
