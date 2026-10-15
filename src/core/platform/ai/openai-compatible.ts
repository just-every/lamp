import { z } from "zod";
import { SUGGESTION_INSTRUCTIONS } from "./instructions";
import type { AiProvider, AiSuggestion, AiSuggestionContext } from "./provider";

const field = (max: number) => z.object({ text: z.string().trim().max(max), sources: z.array(z.string().max(40)).max(40).default([]) });
const suggestionSchema = z.object({ affectedAudience: field(250), customerImpact: field(250), whatStillWorks: field(250), details: field(500) });

export function createOpenAiCompatibleProvider(input: { endpoint: string; apiKey: string; model: string; fetcher?: typeof fetch }): AiProvider {
  const fetcher = input.fetcher ?? fetch;
  return {
    async suggestUpdate(context: AiSuggestionContext): Promise<AiSuggestion> {
      const controller = new AbortController();
      // Reserve 2s for Worker and composer handling within DRAFT-003's 20s visible-error bound.
      const timeout = setTimeout(() => controller.abort(new Error("AI provider exceeded its 18 second transport deadline.")), 18_000);
      try {
        const response = await fetcher(input.endpoint, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` }, body: JSON.stringify({ model: input.model, response_format: { type: "json_object" }, messages: [{ role: "system", content: SUGGESTION_INSTRUCTIONS }, { role: "user", content: JSON.stringify(context) }] }) });
        if (!response.ok) throw new Error(`AI provider returned ${response.status}.`);
        const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error("AI provider returned no suggested update.");
        let parsed;
        try { parsed = suggestionSchema.safeParse(JSON.parse(content)); } catch { throw new Error("AI provider returned an invalid suggested update."); }
        if (!parsed.success) throw new Error("AI provider returned an invalid suggested update.");
        return parsed.data;
      } catch (cause) {
        if (controller.signal.aborted) throw new Error("AI provider did not answer before the request deadline.");
        throw cause;
      } finally { clearTimeout(timeout); }
    },
  };
}
