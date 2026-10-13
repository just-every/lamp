-- First-run setup at /setup is new. An installation that already has an
-- operator was set up before it existed, so it is recorded as complete.
INSERT OR IGNORE INTO setup_readiness (step, evidence_key, checked_at)
SELECT 'first-run', 'complete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM operators);
