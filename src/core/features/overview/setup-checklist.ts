import type { PageSettingsService } from '../page-settings';
import type { OverviewRepository } from './repository';
import { checkSender, senderEvidenceKey, type SenderCheckOptions } from './sender-check';

export interface SetupStep { id: string; label: string; done: boolean; href: string; detail: string }
export interface SetupChecklist { steps: SetupStep[]; complete: boolean; completed: number; publicOrigin: string }
export interface SetupChecklistService {
  get(hasComponent: boolean): Promise<SetupChecklist>;
  checkSender(operatorEmail: string): Promise<string>;
  openPublic(): Promise<string>;
  checkSubscribe(): Promise<string>;
  acceptAddress(): Promise<void>;
  firstRunComplete(): Promise<boolean>;
  completeFirstRun(): Promise<void>;
}
export function createSetupChecklistService(repository: OverviewRepository, settings: PageSettingsService, options: {
  publicOrigin: () => Promise<string>;
  sender: SenderCheckOptions;
  fetcher?: typeof fetch;
}): SetupChecklistService {
  async function page() {
    const value = await settings.get();
    if (!value) throw new Error('Save your page settings first.');
    return value;
  }
  async function publicResponse() {
    const origin = await options.publicOrigin();
    // Workerd supports manual/follow, not the browser's error redirect mode.
    // Fetch once without following, then require the canonical response itself.
    const response = await (options.fetcher ?? fetch)(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } });
    if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/html')) throw new Error('The public page is not reachable yet. Check the deployment address and try again.');
    return { origin, html: await response.text() };
  }
  return {
    async get(hasComponent) {
      const [value, evidence, published, origin] = await Promise.all([settings.get(), repository.evidence(), repository.hasPublishedIncident(), options.publicOrigin()]);
      const witnessed = (step: string, key: string) => evidence.some(row => row.step === step && row.evidence_key === key);
      const senderKey = value ? await senderEvidenceKey(value.mailFromAddress, options.sender) : '';
      const branded = Boolean(value?.pageName.trim() && !['Atlas Cloud Status', 'Your status page', 'Status page'].includes(value.pageName.trim()) && value.tagline.trim() && /^#[0-9a-f]{6}$/i.test(value.accentColor));
      let timezone = false;
      if (value?.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); timezone = true; } catch { /* Invalid stored zone remains open. */ } }
      const steps: SetupStep[] = [
        { id: 'branding', label: 'Page name and branding', done: branded, href: '/app/settings', detail: 'Save your page name, description, and accent colour.' },
        { id: 'timezone', label: 'Time zone', done: timezone, href: '/app/settings', detail: value?.timezone ? `Page time zone: ${value.timezone}` : 'Choose the time zone your readers will see.' },
        { id: 'sender', label: options.sender.local ? 'Local outbox ready' : 'Sender verified', done: witnessed('sender', senderKey), href: '/app/settings#sender-check', detail: options.sender.local ? 'Run the mail check to capture a message in the local outbox.' : 'Check your sender’s domain authentication with the mail provider.' },
        { id: 'component', label: 'First component', done: hasComponent, href: '/app/components', detail: 'Add a service whose availability you report.' },
        { id: 'incident', label: 'First incident published', done: published, href: '/app/incidents', detail: 'Publish your first customer update when there is an incident to report.' },
        { id: 'public', label: 'Public page opened', done: witnessed('public', origin), href: '/api/app/overview/open-public', detail: 'Check and open the page your customers will read.' },
        { id: 'subscribe', label: 'Subscribe form reachable', done: witnessed('subscribe', origin), href: '/api/app/overview/check-subscribe', detail: 'Check that the public response includes the working subscription form.' },
        { id: 'domain', label: 'Public address and custom domain', done: witnessed('domain', origin), href: '/app/settings#public-address', detail: 'Keep your current address or follow the custom domain guide.' },
      ];
      return { steps, completed: steps.filter(step => step.done).length, complete: steps.every(step => step.done), publicOrigin: origin };
    },
    async checkSender(operatorEmail) {
      await repository.clear('sender');
      const value = await page();
      const message = await checkSender(value.mailFromAddress, operatorEmail, options.sender);
      await repository.record('sender', await senderEvidenceKey(value.mailFromAddress, options.sender));
      return message;
    },
    async openPublic() {
      const { origin } = await publicResponse();
      await repository.record('public', origin);
      return `${origin}/`;
    },
    async checkSubscribe() {
      await repository.clear('subscribe');
      const { origin, html } = await publicResponse();
      // Inspect the real rendered form; checking a route constant says nothing
      // about whether a visitor can reach its input and submit control.
      const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? [];
      const reachable = forms.some(form => /\baction=["']\/subscribe["']/i.test(form) && /\bmethod=["']post["']/i.test(form) && /<input\b[^>]*\bname=["']email["']/i.test(form) && /<button\b/i.test(form));
      if (!reachable) throw new Error('The public response does not contain the subscription form. Rebuild the public page and try again.');
      await repository.record('subscribe', origin);
      return 'The public page returned its email subscription form. Confirmation and inbox delivery are separate checks.';
    },
    async acceptAddress() { await repository.record('domain', await options.publicOrigin()); },
    // First-run setup at /setup is stored once and never cleared by a setup rerun.
    async firstRunComplete() { return (await repository.evidence()).some(row => row.step === 'first-run'); },
    async completeFirstRun() {
      if (!(await settings.get())?.pageName.trim()) throw new Error('Save your page name first.');
      await repository.record('first-run', 'complete');
    },
  };
}
