ALTER TABLE components ADD COLUMN only_show_if_degraded INTEGER NOT NULL DEFAULT 0 CHECK (only_show_if_degraded IN (0, 1));
ALTER TABLE components ADD COLUMN uptime_start_date TEXT;
