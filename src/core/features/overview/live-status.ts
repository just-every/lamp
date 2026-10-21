import type { PageSettingsService } from '../page-settings';
import type { OverviewRepository } from './repository';
import { checkSender, senderEvidenceKey, type SenderCheckOptions } from './sender-check';

/** One check Lamp ran on its own. reason is a short sentence with the one thing to do; null when it passed. */
export interface LiveCheck { ok: boolean; checkedAt: string; reason: string | null }
export interface SenderStatus { state: 'local' | 'verified' | 'failed' | 'unchecked'; message: string | null; checkedAt: string | null }
export interface LiveStatus {
  publicOrigin: string;
  publishedAt: string | null;
  page: LiveCheck | null;
  subscribe: LiveCheck | null;
  sender: SenderStatus;
  /** The relay exposes submission, without a provider domain-verification read. */
  senderVerificationManaged: boolean;
}
export interface LiveStatusService {
  /** Current state; checks older than the latest publish or two minutes run first. */
  get(): Promise<LiveStatus>;
  /** The page and subscribe-form checks, as the minute Cron runs them. */
  runChecks(): Promise<void>;
  /** The mail-provider check, when the sender changed or a day has passed. */
  checkSenderIfDue(operatorEmail?: string): Promise<void>;
  firstRunComplete(): Promise<boolean>;
  completeFirstRun(): Promise<void>;
}

const PAGE_STEP = 'page-check';
const SENDER_FAILED_STEP = 'sender-failed';
const PAGE_CHECK_MAX_AGE_MS = 2 * 60_000;
const SENDER_CHECK_MAX_AGE_MS = 24 * 60 * 60_000;
const NOT_ANSWERING = 'Your public page is not answering. Check the deployment address in Settings.';
const NO_FORM = 'Your public page has no subscribe form. Save Settings once to republish it.';

export function createLiveStatusService(repository: OverviewRepository, settings: PageSettingsService, options: {
  publicOrigin: () => Promise<string>;
  publishedAt: () => Promise<string | null>;
  sender: SenderCheckOptions;
  fetcher?: typeof fetch;
}): LiveStatusService {
  async function runChecks() {
    // Nothing is published before first-run setup; there is nothing to check yet.
    if (!await options.publishedAt()) return;
    const origin = await options.publicOrigin();
    let page: string | null = null, subscribe: string | null = null;
    try {
      // Workerd supports manual/follow, not the browser's error redirect mode.
      // Fetch once without following, then require the canonical response itself.
      const response = await (options.fetcher ?? fetch)(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } });
      if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/html')) { await response.body?.cancel(); page = NOT_ANSWERING; }
      else {
        // Inspect the real rendered form; a route constant says nothing about
        // whether a visitor can reach its input and submit control.
        const forms = (await response.text()).match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? [];
        if (!forms.some(form => /\baction=["']\/subscribe["']/i.test(form) && /\bmethod=["']post["']/i.test(form) && /<input\b[^>]*\bname=["']email["']/i.test(form) && /<button\b/i.test(form))) subscribe = NO_FORM;
      }
    } catch { page = NOT_ANSWERING; }
    await repository.record(PAGE_STEP, JSON.stringify({ origin, page, subscribe: page ? NOT_ANSWERING : subscribe }));
  }

  async function storedPageChecks(origin: string) {
    const checkedAt = (await repository.evidence()).find(row => row.step === PAGE_STEP);
    if (!checkedAt) return null;
    const value = JSON.parse(checkedAt.evidence_key) as { origin: string; page: string | null; subscribe: string | null };
    return value.origin === origin ? { ...value, checkedAt: checkedAt.checked_at } : null;
  }

  async function checkSenderIfDue(operatorEmail = '') {
    if (options.sender.local) return;
    const value = await settings.get();
    if (!value) return;
    const key = await senderEvidenceKey(value.mailFromAddress, options.sender);
    const evidence = await repository.evidence();
    const last = evidence.find(row => (row.step === 'sender' && row.evidence_key === key) || (row.step === SENDER_FAILED_STEP && row.evidence_key.startsWith(`${key}\n`)));
    if (last && Date.now() - Date.parse(last.checked_at) < SENDER_CHECK_MAX_AGE_MS) return;
    try {
      await checkSender(value.mailFromAddress, operatorEmail, options.sender);
      await repository.clear(SENDER_FAILED_STEP);
      await repository.record('sender', key);
    } catch (cause) {
      await repository.clear('sender');
      await repository.record(SENDER_FAILED_STEP, `${key}\n${cause instanceof Error ? cause.message : 'Your mail provider could not confirm the sender.'}`);
    }
  }

  async function sender(): Promise<SenderStatus> {
    if (options.sender.local) return { state: 'local', message: null, checkedAt: null };
    const value = await settings.get();
    if (!value) return { state: 'unchecked', message: null, checkedAt: null };
    const key = await senderEvidenceKey(value.mailFromAddress, options.sender);
    const evidence = await repository.evidence();
    const verified = evidence.find(row => row.step === 'sender' && row.evidence_key === key);
    if (verified) return { state: 'verified', message: null, checkedAt: verified.checked_at };
    const failed = evidence.find(row => row.step === SENDER_FAILED_STEP && row.evidence_key.startsWith(`${key}\n`));
    return failed ? { state: 'failed', message: failed.evidence_key.slice(key.length + 1), checkedAt: failed.checked_at } : { state: 'unchecked', message: null, checkedAt: null };
  }

  return {
    async get() {
      const [origin, publishedAt] = await Promise.all([options.publicOrigin(), options.publishedAt()]);
      let stored = await storedPageChecks(origin);
      const stale = !stored || Date.now() - Date.parse(stored.checkedAt) > PAGE_CHECK_MAX_AGE_MS || (publishedAt !== null && Date.parse(stored.checkedAt) < Date.parse(publishedAt));
      if (stale && publishedAt) { await runChecks(); stored = await storedPageChecks(origin); }
      await checkSenderIfDue();
      const check = (reason: string | null): LiveCheck | null => stored ? { ok: reason === null, checkedAt: stored.checkedAt, reason } : null;
      return { publicOrigin: origin, publishedAt, page: check(stored?.page ?? null), subscribe: check(stored?.subscribe ?? null), sender: await sender(),
        senderVerificationManaged: !options.sender.local && options.sender.provider === 'rer' && options.sender.mail.configured };
    },
    runChecks,
    checkSenderIfDue,
    // First-run setup at /setup is stored once and never cleared by a setup rerun.
    async firstRunComplete() { return (await repository.evidence()).some(row => row.step === 'first-run'); },
    async completeFirstRun() {
      if (!(await settings.get())?.pageName.trim()) throw new Error('Save your page name first.');
      await repository.record('first-run', 'complete');
    },
  };
}
