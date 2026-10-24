const DAY = 86400_000;
/** Move each expired bucket exactly once in one transaction. Counts preserve
 * weighted means when a partial hour/day crosses a retention boundary later. */
export function retentionStatements(db: D1Database, now: number) {
  const minuteCutoff = Math.floor((now - DAY) / 60_000) * 60_000;
  const hourCutoff = Math.floor((now - 30 * DAY) / 3600_000) * 3600_000;
  const dayCutoff = Math.floor((now - 90 * DAY) / DAY) * DAY;
  const roll = (from: number, to: number, cutoff: number) => [
    db.prepare(`INSERT INTO metric_points(metric_id,resolution,bucket,value_sum,samples,last_at)
      SELECT metric_id,?,CAST(bucket / ? AS INTEGER)*?,SUM(value_sum),SUM(samples),MAX(last_at)
      FROM metric_points WHERE resolution=? AND bucket<? GROUP BY metric_id,CAST(bucket / ? AS INTEGER)
      ON CONFLICT(metric_id,resolution,bucket) DO UPDATE SET value_sum=metric_points.value_sum+excluded.value_sum,samples=metric_points.samples+excluded.samples,last_at=MAX(metric_points.last_at,excluded.last_at)`)
      .bind(to,to*1000,to*1000,from,cutoff,to*1000),
    db.prepare("DELETE FROM metric_points WHERE resolution=? AND bucket<?").bind(from,cutoff),
  ];
  return [...roll(60,3600,minuteCutoff),...roll(3600,86400,hourCutoff),db.prepare("DELETE FROM metric_points WHERE resolution=86400 AND bucket<?").bind(dayCutoff)];
}
