import { MINUTE, type TrafficStorage } from './storage';
import { TRAFFIC_SURFACES, trafficSurfaceNames } from './surfaces';
import type { RecoveryCheck } from '../brief/recovery-check';

export function createTrafficAlerts(storage: TrafficStorage, unresolved: () => Promise<boolean>, alert: (input: { eventId: string; title: string; text: string }) => Promise<void>) {
  return {
    async run(at: number) {
      // Leave one minute for in-flight waitUntil increments before evaluating.
      const minute = Math.floor(at / MINUTE) - 2;
      const { multiple } = await storage.settings();
      for (const surface of TRAFFIC_SURFACES) {
        const stored = await storage.state(surface);
        const state = stored.value;
        const deliver = async (signal: NonNullable<typeof state>['pending']) => {
          if (signal && !await unresolved()) await alert({ eventId: `traffic:${surface}:${signal.minute}`, title: 'Public-page traffic spike', text: `${trafficSurfaceNames[surface]}: ${signal.count} requests in one minute, against a trailing seven-day same-hour baseline of ${signal.baseline?.toFixed(2)} per minute. Customers may be seeing a problem before monitoring does.` });
        };
        // Native outbox event uniqueness makes a failed acknowledgement or
        // repeated Cron safe. Acknowledge while advancing the next minute, so
        // normal Cron does at most one state PUT per surface per minute.
        await deliver(state?.pending ?? null);
        if (state && state.minute >= minute) continue;
        let next = state ? state.minute + 1 : minute;
        let active = state?.active ?? false;
        let pending: NonNullable<typeof state>['pending'] = null;
        let evaluated = next;
        for (let count = 0; next <= minute && count < 32; next++, count++) {
          const signal = await storage.signal(surface, next);
          const elevated = signal.baseline !== null && signal.count > signal.baseline * multiple;
          pending = elevated && !active && !await unresolved() ? signal : null;
          active = elevated;
          evaluated = next;
          if (pending) break;
        }
        if (await storage.saveState(surface, { minute: evaluated, active, pending }, stored.etag)) await deliver(pending);
      }
    },
    async recovery(check: RecoveryCheck): Promise<RecoveryCheck> {
      const minute = Math.floor(Date.parse(check.checkedAt) / MINUTE) - 2;
      const signals = await Promise.all(TRAFFIC_SURFACES.map(surface => storage.signal(surface, minute)));
      const trafficLearning = signals.filter(signal => signal.baseline === null).map(signal => signal.surface);
      // A surface without a usual level is never evidence either way: it stays not tracked.
      if (trafficLearning.length === signals.length) return { ...check, trafficLearning };
      // The recovery door uses current counters, rather than a potentially old
      // alert state, and conservatively calls >1.5× baseline still elevated.
      // It reads one minute, so a near-baseline row claims no recovery time.
      const items: RecoveryCheck['items'] = signals.flatMap(signal => signal.baseline === null ? [] : [{
        kind: 'traffic' as const, source: 'Public-page traffic', key: signal.surface,
        state: signal.count > signal.baseline * 1.5 ? 'firing' as const : 'recovered' as const,
        evidenceAt: new Date(signal.minute * MINUTE).toISOString(), recoveredAt: null,
      }]);
      const learning = trafficLearning.length ? [`Traffic: still learning the usual level for ${trafficLearning.length} public ${trafficLearning.length === 1 ? 'page' : 'pages'}`] : [];
      return { ...check, passed: check.passed && items.every(item => item.state === 'recovered'), items: [...check.items, ...items], notTracked: [...check.notTracked.filter(value => value !== 'Public-page traffic baseline'), ...learning], trafficLearning };
    },
  };
}
