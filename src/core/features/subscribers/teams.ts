import { validateDestination } from '../../../../modules/integrations/core/destination';
import { createChannelTransport } from '../channels/transport';
import { openUrl, sealUrl, sealingSecrets } from '../channels/sealing';
import { renderUpdateTeams } from '../../shared/update-links';

/** Workflows trigger hosts documented by Microsoft. Legacy Office connectors
 * are deliberately excluded from new self-service Workflows subscriptions.
 * https://learn.microsoft.com/troubleshoot/power-platform/power-automate/flow-run-issues/triggers-troubleshoot */
export function teamsWorkflowUrl(input: string): string {
  try {
    const url = validateDestination(input.trim());
    if (url.port || url.hash || !(url.hostname.endsWith('.logic.azure.com') || url.hostname.endsWith('.environment.api.powerplatform.com'))) throw new Error();
    if (!/\/workflows\/[^/]+\/triggers\/[^/]+\/paths\/invoke$/.test(url.pathname) || !url.searchParams.get('sig')) throw new Error();
    return url.href;
  } catch { throw new Error('Paste the HTTPS webhook URL from Teams Workflows: When a Teams webhook request is received. Only Microsoft Workflows hosts are accepted.'); }
}

/** Microsoft Teams Workflows request envelope and external navigation action:
 * https://learn.microsoft.com/connectors/teams/#when-a-teams-webhook-request-is-received
 * https://learn.microsoft.com/adaptive-cards/schema-explorer/action-open-url */
export function teamsAdaptiveCard(lines: string[], actions: Array<{ title: string; url: string }>) {
  return JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
    body: lines.map((text, index) => ({ type: 'TextBlock', text: renderUpdateTeams(text), wrap: true, ...(index === 0 ? { weight: 'Bolder' } : {}) })),
    actions: actions.map(action => ({ type: 'Action.OpenUrl', ...action })),
  } }] });
}

export interface TeamsOptions { webhookSecret?: string; developmentReceiver?: string; unavailable?: string | null; effectsPaused?: boolean }
export function teamsTransport(options: TeamsOptions) {
  const transport = createChannelTransport({ developmentReceiver: options.developmentReceiver });
  return {
    async seal(url: string, id: string) { return sealUrl(url, id, sealingSecrets(options.webhookSecret)); },
    async send(sealed: string, id: string, body: string) {
      if (options.unavailable) throw new Error(options.unavailable);
      if (options.effectsPaused) throw new Error('Teams subscriptions are paused during this installation move. Try again when subscriptions resume.');
      const url = teamsWorkflowUrl(await openUrl(sealed, id, sealingSecrets(options.webhookSecret)));
      try {
        const response = await transport.send({ url, headers: { 'content-type': 'application/json; charset=utf-8' }, body });
        if (response.status < 200 || response.status >= 300) throw new Error();
      } catch { throw new Error('Microsoft did not accept the Teams card. Check that the Workflow is enabled and permits Anyone to send webhook requests, then try again.'); }
    },
  };
}
