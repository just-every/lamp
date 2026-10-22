import { IMAGE_MODEL, type AiRunner } from "./image-models.ts";
import { CHECK_MODEL } from "./check.ts";
import { SUBJECT_MODEL } from "./subject.ts";

/** The only models the house style may call: the picture, the text model that picks and compares objects, and the
 *  vision model that names the finished picture. Any other model is refused before a request leaves the Worker. */
export const HOUSE_STYLE_MODELS: readonly string[] = [IMAGE_MODEL, SUBJECT_MODEL, CHECK_MODEL];

function allowlisted(ai: AiRunner): AiRunner {
  return {
    run(model, inputs) {
      if (!HOUSE_STYLE_MODELS.includes(model)) return Promise.reject(new Error(`Lamp doesn't make house styles with ${model}.`));
      return ai.run(model, inputs);
    },
  };
}

/** Workers AI's run door as a loopback server plays it in local development: one POST per run, the inputs as JSON
 *  (or FLUX.2's multipart body as it is) and `{ success, result }` back, as Workers AI's REST API answers. */
function loopbackWorkersAi(origin: string): AiRunner {
  return {
    async run(model, inputs) {
      const multipart = (inputs as { multipart?: { body: ReadableStream; contentType: string } }).multipart;
      const response = await fetch(`${origin}/ai/run/${model}`, {
        method: "POST",
        headers: { "Content-Type": multipart ? multipart.contentType : "application/json" },
        body: multipart ? await new Response(multipart.body).arrayBuffer() : JSON.stringify(inputs),
        signal: AbortSignal.timeout(120_000),
      });
      const answer = await response.json().catch(() => null) as { success?: boolean; result?: unknown } | null;
      if (!response.ok || !answer?.success) throw new Error(`Workers AI answered ${response.status}.`);
      return answer.result;
    },
  };
}

/** The install's Workers AI binding, held to the house style's models; null when the install has none. Base grants an
 *  app Worker no `ai` binding until its AI consumer contract ships, so a deployed install is not connected yet and
 *  says so. In local Vite development only, a loopback stand-in can play Workers AI for journeys and tests. */
export function houseStyleAi(binding: AiRunner | undefined, devOrigin: string | undefined): AiRunner | null {
  if (binding) return allowlisted(binding);
  return import.meta.env?.DEV && devOrigin?.startsWith("http://127.0.0.1:") ? allowlisted(loopbackWorkersAi(devOrigin)) : null;
}
