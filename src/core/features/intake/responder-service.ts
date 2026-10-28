import { openUrl, sealingSecrets } from "../channels/sealing";
import { nowIso } from "../../shared/ids";
import { createResponderRepository } from "./responder-repository";
import { agentEffectHandled, registerAgentEffectHandler } from '../agent-door/final-dispatch';
import { nativeAgentAttribution } from '../agent-door/provenance.repository';
import { hashOpaqueToken } from '../../platform/security/opaque-tokens';

/** Provider destinations are fixed here. Neither webhook payload nor connected
 * credentials can select a URL; redirects never receive the API key. */
export function createResponderService(db: D1Database, options: { webhookSecret?: string; effectsPaused?: boolean; publicOrigin: () => Promise<string> }) {
  const repository = createResponderRepository(db);
  const service = {
    publicationStatements: repository.publicationStatements,
    async dispatchPublication(updateId: string,id?: string) {
      if (options.effectsPaused) return;
      for (const post of await repository.pending(updateId,id)) {
        if(await agentEffectHandled(db,'responder',post.id))continue;
        if (!await repository.claim(post.id, nowIso())) continue;
        let error: string | null = null;
        try {
          const credentials = JSON.parse(await openUrl(post.sealedCredentials, post.sourceId, sealingSecrets(options.webhookSecret))) as { apiKey: string; fromEmail: string; site?: string; cloudId?: string; email?: string };
          const permalink = new URL(`/incidents/${encodeURIComponent(post.reference)}`, await options.publicOrigin()).href;
          const attribution=await nativeAgentAttribution(db,'incident-update',post.incidentUpdateId);
          const text = [`${post.reference} ${post.lifecycle}: ${post.title}`, post.customerImpact, post.affectedAudience, post.whatStillWorks, post.details, ...(post.nextUpdateAt ? [`Next update: ${post.nextUpdateAt}`] : []), ...(attribution?[`Prepared by ${attribution.label}`]:[]), permalink].filter(Boolean).join("\n\n");
          if (post.preset === "pagerduty") {
            const response = await fetch(`https://api.pagerduty.com/incidents/${encodeURIComponent(post.externalId)}/notes`, {
              method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
              headers: { Authorization: `Token token=${credentials.apiKey}`, Accept: "application/vnd.pagerduty+json;version=2", "Content-Type": "application/json", From: credentials.fromEmail },
              body: JSON.stringify({ note: { content: text } }),
            });
            if (!response.ok) error = `PagerDuty note failed (HTTP ${response.status}).`;
            await response.body?.cancel();
          } else {
            // Only the connected, validated Atlassian site or Opsgenie's fixed
            // vendor host can receive credentials. Payloads cannot select URLs.
            const base = post.preset === "jsm" ? `https://api.atlassian.com/jsm/ops/api/${encodeURIComponent(credentials.cloudId!)}/v1/alerts` : "https://api.opsgenie.com/v2/alerts";
            const authorization = post.preset === "jsm" ? `Basic ${btoa(`${credentials.email}:${credentials.apiKey}`)}` : `GenieKey ${credentials.apiKey}`;
            const send = async (action: "notes" | "close", body: unknown) => {
              const response = await fetch(`${base}/${encodeURIComponent(post.externalId)}/${action}${post.preset === "opsgenie" ? "?identifierType=id" : ""}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
              const ok = response.ok; await response.body?.cancel();
              if (!ok) throw new Error("Vendor refused request");
            };
            await send("notes", { note: text, source: "Lamp" });
            if (post.closeAlertOnResolve && post.lifecycle === "Resolved") await send("close", { note: text, source: "Lamp" });
          }
        } catch {
          // No response text, URL, header or credential is written to a receipt.
          error = "Responder update could not be sent. Check the connection and provider availability.";
        }
        await repository.finish(post.id, error, nowIso());
      }
    },
  };
  registerAgentEffectHandler(db,'responder',{
    async describe(id) {
      const row=(await repository.pending(undefined,id))[0];
      if(!row)return null;
      const closes=row.preset!=='pagerduty'&&row.closeAlertOnResolve&&row.lifecycle==='Resolved';
      const content=JSON.stringify({reference:row.reference,title:row.title,lifecycle:row.lifecycle,customerImpact:row.customerImpact,
        affectedAudience:row.affectedAudience,whatStillWorks:row.whatStillWorks,details:row.details,nextUpdateAt:row.nextUpdateAt,closeAlert:closes});
      return {eventId:row.incidentUpdateId,recipient:`${row.preset} alert ${row.externalId}`,content,counterparty:'known' as const,
        revision:await hashOpaqueToken(JSON.stringify({content,source:row.sourceId,credentials:row.sealedCredentials})),
        classes:closes?[{class:'external' as const,facts:{measure:2,counterparty:'known' as const}},{class:'live' as const,facts:{measure:1,service:`${row.preset} alert ${row.externalId}`}}]:undefined};
    },
    async dispatch(id){const row=(await repository.pending(undefined,id))[0];if(!row)throw new Error('Responder post unavailable.');await service.dispatchPublication(row.incidentUpdateId,id);},
  });
  return service;
}
