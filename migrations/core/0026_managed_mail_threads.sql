-- The relay assigns one stable RFC Message-ID per installation and message key.
-- Keep its receipt in the existing send ledger so later incident updates thread
-- across restarts, recipients and delivery retries.
ALTER TABLE mail_send_ledger ADD COLUMN message_key TEXT;
CREATE INDEX mail_send_ledger_message_key ON mail_send_ledger(message_key);
