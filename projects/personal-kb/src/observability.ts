import { DBContext } from './db/client.js';

export function logIngestEvent(
  ctx: DBContext,
  params: { jobId?: number; sourceUrl?: string; sourceId?: number; level?: 'info' | 'warn' | 'error'; eventType: string; event?: Record<string, unknown> }
): void {
  ctx.db
    .prepare(
      `INSERT INTO ingest_logs (job_id, source_url, source_id, level, event_type, event_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.jobId || null,
      params.sourceUrl || null,
      params.sourceId || null,
      params.level || 'info',
      params.eventType,
      JSON.stringify(params.event || {})
    );
}

export function recordJobMetric(
  ctx: DBContext,
  params: { jobId?: number; metricName: string; metricValue: number; labels?: Record<string, unknown> }
): void {
  ctx.db
    .prepare('INSERT INTO job_metrics (job_id, metric_name, metric_value, labels_json) VALUES (?, ?, ?, ?)')
    .run(params.jobId || null, params.metricName, params.metricValue, JSON.stringify(params.labels || {}));
}

export function healthStatus(ctx: DBContext): {
  dbOk: boolean;
  sourceCount: number;
  chunkCount: number;
  jobs: { running: number; done: number; failed: number };
  recentFailures24h: number;
} {
  const dbOk = Boolean(ctx.db.prepare('SELECT 1 as ok').get());
  const sourceCount = Number((ctx.db.prepare('SELECT COUNT(*) as c FROM sources').get() as { c: number }).c);
  const chunkCount = Number((ctx.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number }).c);
  const jobs = ctx.db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM jobs`
    )
    .get() as { running: number | null; done: number | null; failed: number | null };

  const recentFailures24h = Number(
    (
      ctx.db
        .prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'failed' AND created_at >= datetime('now', '-1 day')")
        .get() as { c: number }
    ).c
  );

  return {
    dbOk,
    sourceCount,
    chunkCount,
    jobs: {
      running: jobs.running || 0,
      done: jobs.done || 0,
      failed: jobs.failed || 0
    },
    recentFailures24h
  };
}
