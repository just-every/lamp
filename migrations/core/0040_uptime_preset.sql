-- Preserve earlier preset constraints and add the sibling monitor's signed source.
ALTER TABLE alert_sources ADD COLUMN uptime_preset TEXT CHECK (uptime_preset = 'uptime');
ALTER TABLE alert_sources ADD COLUMN monitor_mappings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(monitor_mappings_json));
