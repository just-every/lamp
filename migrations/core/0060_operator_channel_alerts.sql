-- Existing publication channels remain unchanged until an owner opts in.
ALTER TABLE channel_destinations ADD COLUMN operator_alerts INTEGER NOT NULL DEFAULT 0 CHECK(operator_alerts IN (0,1));
