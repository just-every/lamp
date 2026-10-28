-- Aggregate-only public performance series. Existing tables and backups remain additive.
CREATE TABLE public_metrics (
  id TEXT PRIMARY KEY NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES alert_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL, unit TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('push','uptime','datadog','newrelic','pingdom','prometheus')),
  query TEXT NOT NULL DEFAULT '', endpoint TEXT, account_id TEXT, region TEXT,
  sealed_credentials TEXT,
  last_reported_at INTEGER, stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
  pull_after INTEGER NOT NULL DEFAULT 0, pull_lease_until INTEGER,
  error TEXT, change_id TEXT, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE metric_points (
  metric_id TEXT NOT NULL REFERENCES public_metrics(id) ON DELETE CASCADE,
  resolution INTEGER NOT NULL CHECK(resolution IN (60,3600,86400)),
  bucket INTEGER NOT NULL CHECK(bucket % (resolution * 1000) = 0),
  value_sum REAL NOT NULL, samples INTEGER NOT NULL CHECK(samples > 0),
  last_at INTEGER NOT NULL,
  PRIMARY KEY(metric_id,resolution,bucket)
);
CREATE INDEX metric_points_retention ON metric_points(resolution,bucket);
CREATE TRIGGER public_metrics_limit BEFORE INSERT ON public_metrics WHEN (SELECT count(*) FROM public_metrics) >= 10 BEGIN SELECT RAISE(ABORT,'A page can show at most 10 public metrics.'); END;
CREATE TRIGGER public_metrics_dirty_insert AFTER INSERT ON public_metrics BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default'; END;
CREATE TRIGGER public_metrics_dirty_update AFTER UPDATE ON public_metrics WHEN NEW.name<>OLD.name OR NEW.unit<>OLD.unit OR NEW.component_id<>OLD.component_id OR NEW.last_reported_at IS NOT OLD.last_reported_at OR NEW.stale<>OLD.stale BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default'; END;
CREATE TRIGGER public_metrics_dirty_delete AFTER DELETE ON public_metrics BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default'; END;
CREATE TRIGGER metric_points_dirty_insert AFTER INSERT ON metric_points BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default'; END;
CREATE TRIGGER metric_points_dirty_update AFTER UPDATE ON metric_points BEGIN UPDATE public_snapshot_work SET requested_revision=requested_revision+1 WHERE id='default'; END;
