-- Unnumbered expansion for consumers that applied the pre-v2 schema proposal.
-- Apply exactly once via the consumer's migration ledger, not on fresh v2 installs.
-- Preserve historical provenance as NULL; the v2 API requires context for every new use.
ALTER TABLE integration_token_usage ADD COLUMN request_id TEXT;
ALTER TABLE integration_token_usage ADD COLUMN resource TEXT;
