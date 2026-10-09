-- Actual SendGrid X-Message-ID, distinct from the local ledger/callback ID.
-- Existing acceptance has no retained HTTP receipt; do not invent one.
ALTER TABLE mail_send_ledger ADD COLUMN provider_receipt TEXT;
