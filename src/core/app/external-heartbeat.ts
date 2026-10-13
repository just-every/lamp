import type { AppBindings } from './types';
import type { createApp } from './server';

/** A heartbeat has no payload, headers, cookies or product identifiers. */
export async function pingExternalHeartbeat(bindings: AppBindings, runtime: ReturnType<typeof createApp>, scheduledAt: number) {
  if (!bindings.LAMP_HEARTBEAT_URL || bindings.EFFECTS_PAUSED === "1") return;
  const minutes = Number(bindings.LAMP_HEARTBEAT_INTERVAL_MINUTES ?? 5);
  if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error('Invalid external heartbeat interval');
  // Cron stays on the one-minute grid. A missed tick waits for the next grid
  // point; duplicate pings are harmless and never represent extra health.
  if (Math.floor(scheduledAt / 60000) % minutes !== 0) return;
  let url: URL;
  try { url = new URL(bindings.LAMP_HEARTBEAT_URL); } catch { throw new Error('Invalid external heartbeat URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('External heartbeat requires a public HTTPS URL');
  // The normal public health door probes D1, R2 and Queue. A working timer
  // alone must never mask one of these dependencies being unavailable.
  const health = await runtime.app.request(`https://${bindings.LAMP_APP_HOST}/health`);
  if (!health.ok) return;
  let response: Response;
  try { response = await fetch(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) }); } catch { throw new Error('External heartbeat ping failed'); }
  await response.body?.cancel();
  if (!response.ok) throw new Error('External heartbeat ping was rejected');
}
