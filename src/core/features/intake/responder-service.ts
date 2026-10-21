import { openUrl, sealingSecrets } from "../channels/sealing";
import { nowIso } from "../../shared/ids";
import { createResponderRepository } from "./responder-repository";

/** Provider destinations are fixed here. Neither webhook payload nor connected
 * credentials can select a URL; redirects never receive the API key. */
export function createResponderService(db: D1Database, options: { webhookSecret?: string; effectsPaused?: boolean; publicOrigin: () => Promise<string> }) {
  const repository = createResponderRepository(db);
  return {
    publicationStatements: repository.publicationStatements,
    async dispatchPublication(updateId: string) {
      if (options.effectsPaused) return;
      for (const post of await repository.pending(updateId)) {
        if (!await repository.claim(post.id, nowIso())) continue;
        let error: string | null = null;
        try {
          const credentials = JSON.parse(await openUrl(post.sealedCredentials, post.sourceId, sealingSecrets(options.webhookSecret))) as { apiKey: string; fromEmail: string };
          const permalink = new URL(`/incidents/${encodeURIComponent(post.reference)}`, await options.publicOrigin()).href;
          const text = [`${post.reference} ${post.lifecycle}: ${post.title}`, post.customerImpact, post.affectedAudience, post.whatStillWorks, post.details, ...(post.nextUpdateAt ? [`Next update: ${post.nextUpdateAt}`] : []), permalink].filter(Boolean).join("\n\n");
          const response = await fetch(`https://api.pagerduty.com/incidents/${encodeURIComponent(post.externalId)}/notes`, {
            method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
            headers: { Authorization: `Token token=${credentials.apiKey}`, Accept: "application/vnd.pagerduty+json;version=2", "Content-Type": "application/json", From: credentials.fromEmail },
            body: JSON.stringify({ note: { content: text } }),
          });
          if (!response.ok) error = `PagerDuty note failed (HTTP ${response.status}).`;
          await response.body?.cancel();
        } catch {
          // No response text, URL, header or credential is written to a receipt.
          error = "PagerDuty note could not be sent. Check the connection and PagerDuty availability.";
        }
        await repository.finish(post.id, error, nowIso());
      }
    },
  };
}
