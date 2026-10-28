import { agentActionLines,parseAgentAction,type AgentAction } from "../incidents/agent-action";
import { openUrl, sealingSecrets } from "../channels/sealing";
import { nowIso } from "../../shared/ids";
import { createResponderRepository } from "./responder-repository";

/** Provider destinations are fixed here. Neither webhook payload nor connected
 * credentials can select a URL; redirects never receive the API key. */
export function createResponderService(db: D1Database, options: { webhookSecret?: string; effectsPaused?: boolean; publicOrigin: () => Promise<string> }) {
  const repository = createResponderRepository(db);
  let agentAdmission:((id:string,action:AgentAction,generation:string)=>Promise<boolean>)|undefined;
  async function dispatchPosts(updateId:string,targetId?:string,admitted=false) {
      if (options.effectsPaused) return;
      for (const post of await repository.pending(updateId,targetId)) {
        const action=parseAgentAction(post.agentActionJson);
        if(action&&!admitted){if(agentAdmission)await agentAdmission(post.id,action,'0');continue;}
        if (!await repository.claim(post.id, nowIso())) continue;
        let error: string | null = null;
        try {
          const credentials = JSON.parse(await openUrl(post.sealedCredentials, post.sourceId, sealingSecrets(options.webhookSecret))) as { apiKey: string; fromEmail: string; site?: string; cloudId?: string; email?: string };
          const permalink = new URL(`/incidents/${encodeURIComponent(post.reference)}`, await options.publicOrigin()).href;
          const text = [`${post.reference} ${post.lifecycle}: ${post.title}`, post.customerImpact, post.affectedAudience, post.whatStillWorks, post.details, ...(post.nextUpdateAt ? [`Next update: ${post.nextUpdateAt}`] : []), ...agentActionLines(action), permalink].filter(Boolean).join("\n\n");
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
        await repository.finish(post.id, error, nowIso(),action);
      }
  }
  return {
    publicationStatements: repository.publicationStatements,
    setAgentAdmission(admit:(id:string,action:AgentAction,generation:string)=>Promise<boolean>){agentAdmission=admit;},
    dispatchPublication:(updateId:string)=>dispatchPosts(updateId),
    async dispatchAdmittedPost(id:string){const post=await repository.post(id);if(post)await dispatchPosts(post.updateId,id,true);},
  };
}
