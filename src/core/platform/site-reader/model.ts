import { GROUPS_SCHEMA, groupsMessages, productGroups } from "./groups.ts";
import type { NavigationOutline } from "./outline.ts";
import { PRODUCTS_SCHEMA, productsMessages, validProducts } from "./products.ts";
import type { AiRunner, SiteComponent } from "./types.ts";

export const PRODUCTS_MODEL = "@cf/qwen/qwen3.8-27b";
/** Both calls together. */
export const PRODUCTS_TIMEOUT_MS = 20_000;
const SEED = 17;
// Every read shares the two calls' instructions: one affinity routes reads to an instance that holds them already, so most
// reads run with the same cached prefix, which measurably steadies the answers between identical reads.
const AFFINITY = "site-reader-products-v19";

export type ProductsAnswer = { ok: true; components: SiteComponent[] } | { ok: false; reason: "model-error" | "timeout" | "invalid-answer" };
type Call = { ok: true; value: unknown } | { ok: false; reason: "model-error" | "timeout" };

const TIMED_OUT = Symbol("timed out");

/** Workers AI text models answer either `{ response }` or in the OpenAI chat shape; the response is JSON text or already parsed.
 * A Qwen3 model with its thinking pass off answers in `reasoning_content` and leaves `content` empty. */
function answer(output: unknown): unknown {
  const value = output as { response?: unknown; choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[] } | null;
  const message = value?.choices?.[0]?.message;
  const content = value?.response ?? message?.content ?? message?.reasoning_content;
  if (typeof content !== "string") return content ?? null;
  try { return JSON.parse(content.trim()); } catch { return null; }
}

/** One call in JSON schema mode, given whatever is left of the reading's deadline. */
async function call(ai: AiRunner, model: string, messages: unknown[], schema: unknown, maxTokens: number, deadline: number): Promise<Call> {
  const left = deadline - Date.now();
  if (left <= 0) return { ok: false, reason: "timeout" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), left); });
  const inputs = {
    messages, response_format: { type: "json_schema", json_schema: schema }, temperature: 0, seed: SEED, max_tokens: maxTokens,
    // The answer is the judgement; Gemma's thinking pass adds seconds and changes nothing the checks rely on.
    chat_template_kwargs: { enable_thinking: false },
  };
  try {
    const output = await Promise.race([ai.run(model, inputs, { extraHeaders: { "x-session-affinity": AFFINITY }, signal: AbortSignal.timeout(left) }), expired]);
    return output === TIMED_OUT ? { ok: false, reason: "timeout" } : { ok: true, value: answer(output) };
  } catch {
    return { ok: false, reason: "model-error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Two model calls at most: which menu groups list products (and whether as products, variants of one product or a suite's
 * products), then the products in those groups only, each checked against what the page supplied. */
export async function askForProducts(ai: AiRunner, outline: NavigationOutline, base: URL, options: { model?: string; timeoutMs?: number } = {}): Promise<ProductsAnswer> {
  const model = options.model ?? PRODUCTS_MODEL;
  const deadline = Date.now() + (options.timeoutMs ?? PRODUCTS_TIMEOUT_MS);
  const first = await call(ai, model, groupsMessages(outline), GROUPS_SCHEMA, 1000, deadline);
  if (!first.ok) return first;
  const kinds = productGroups(first.value, outline);
  if (!kinds) return { ok: false, reason: "invalid-answer" };
  // No group lists a product: no list, and no second call.
  if (!kinds.size) return { ok: true, components: [] };
  const second = await call(ai, model, productsMessages(outline, kinds), PRODUCTS_SCHEMA, 1000, deadline);
  if (!second.ok) return second;
  const components = validProducts(second.value, outline, base, kinds);
  if (!components) return { ok: false, reason: "invalid-answer" };
  // One product is no list of components. Two or more that all fail the checks are not an answer: the model named links
  // or names the groups never gave.
  if (!components.length && (second.value as { products: unknown[] }).products.length > 1) return { ok: false, reason: "invalid-answer" };
  return { ok: true, components: components.length >= 2 ? components : [] };
}
