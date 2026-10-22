import type { AiRunner } from "./image-models.ts";
import type { MomentSubject } from "./style.ts";

/** The text model that picks the object, through the same Workers AI binding as the picture. */
export const SUBJECT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface BusinessSummary {
  name: string;
  host: string;
  title: string | null;
  description: string | null;
  components: string[];
}

const INSTRUCTIONS = `You choose the one picture at the top of a business's public status page.
On Lamp's own page it is a single pendant lamp, lit, hanging in calm empty space: a quiet object from Lamp's world that carries a soft warm light.
For the business described by the user, choose the one physical object its customers would picture for what it does.
Rules:
- One concrete physical object from the business's own world, simple in shape and recognisable as a small silhouette. For example: a studio microphone for podcast hosting, a stopwatch for time tracking.
- A single object, or one object on its natural cord or stand. Never a scene or a group of things.
- Never a screen, a device showing an interface, a chart, a document, a logo, a letter, a number, a symbol, a flag or a map; never a person, an animal or a body part; nothing alarming, broken, burning or sad.
- It carries a soft warm light in a way natural to it: its own lamp, a glowing face or dial, light from within, a lit window, a small indicator light.
- placement is "hanging" only when the object naturally hangs (a lamp, a bell, a sign on chains); otherwise "standing".
- object: at most 14 words, the object's shape and material, no brand names, no colours (the page sets those).
- light: at most 14 words, how it glows.
- why: at most 20 words, why it stands for this business.
- It rests upright on a table on its own base, feet or stand, in its usual pose: never an object that is held in the hand, carried, tilted or flying.
- base: at most 8 words, what it rests on upright: its own flat base or feet, or the stand or legs it needs (for example a globe's stand or a camera's tripod). For a hanging object, its cord.`;

const SCHEMA = {
  type: "object",
  properties: {
    object: { type: "string" },
    light: { type: "string" },
    placement: { type: "string", enum: ["hanging", "standing"] },
    base: { type: "string" },
    why: { type: "string" },
  },
  required: ["object", "light", "placement", "base", "why"],
};

function business(summary: BusinessSummary) {
  return [
    `Business: ${summary.name}`,
    `Website: ${summary.host}`,
    summary.title ? `Page title: ${summary.title}` : "",
    summary.description ? `Description: ${summary.description}` : "",
    summary.components.length ? `Product areas: ${summary.components.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

/** A JSON answer, as an object or as the text of one. */
export function answerOf(output: unknown): unknown {
  const response = (output as { response?: unknown } | null)?.response;
  return typeof response === "string" ? JSON.parse(response) as unknown : response;
}

function parsed(output: unknown): MomentSubject {
  const subject = answerOf(output) as Partial<MomentSubject> | null;
  const text = (field: unknown, limit: number) => typeof field === "string" && field.trim() && field.trim().split(/\s+/).length <= limit;
  if (!subject || !text(subject.object, 18) || !text(subject.light, 18) || !text(subject.base, 12) || !text(subject.why, 28) || (subject.placement !== "hanging" && subject.placement !== "standing")) {
    throw new Error("The subject model did not return one object, its light, what it rests on and its placement.");
  }
  return { object: subject.object!.trim(), light: subject.light!.trim(), placement: subject.placement, base: subject.base!.trim(), why: subject.why!.trim() };
}

/** Asks the text model for the business's moment object. */
export async function chooseSubject(ai: AiRunner, summary: BusinessSummary): Promise<MomentSubject & { model: string; ms: number }> {
  const started = Date.now();
  const output = await ai.run(SUBJECT_MODEL, {
    messages: [{ role: "system", content: INSTRUCTIONS }, { role: "user", content: business(summary) }],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    temperature: 0.2,
    max_tokens: 300,
  });
  return { ...parsed(output), model: SUBJECT_MODEL, ms: Date.now() - started };
}
