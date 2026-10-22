import type { AiRunner } from "./image-models.ts";
import { answerOf, SUBJECT_MODEL } from "./subject.ts";

/** Names what the picture shows, through the same binding. Asked yes or no, vision models answer "no" even for a lamp;
 *  asked to name the object, they are reliable ("light fixture", "rotary telephone", "a stopwatch"). */
export const CHECK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function namePicture(ai: AiRunner, bytes: Uint8Array) {
  const started = Date.now();
  const output = await ai.run(CHECK_MODEL, {
    messages: [{ role: "user", content: [
      { type: "text", text: "Name the one object this picture shows, in at most six words. Reply with the name only." },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64(bytes)}` } },
    ] }],
    max_tokens: 20,
    temperature: 0,
  });
  const seen = String((output as { response?: unknown } | null)?.response ?? "").trim().split("\n")[0]!.replace(/\.$/, "").trim();
  if (!seen) throw new Error("The check model didn't name the picture's object.");
  return { seen, ms: Date.now() - started };
}

const COMPARE = `You compare what a picture was asked to show with what a viewer saw in it.
Answer whether both name the same kind of physical object. Synonyms, materials and small details may differ: "brass rotary phone" and "Rotary telephone" are the same object; "glass telescope" and "Flashlight" are not, nor are "studio microphone" and "Pendant light".`;

const SAME_SCHEMA = { type: "object", properties: { same: { type: "boolean" } }, required: ["same"] };

/** Whether the vision model's name for the picture is the object that was asked for, judged by the text model. A
 *  picture check that only refused the style sample's lamp let a telescope seen as a "Flashlight" through (L18). */
export async function sameObject(ai: AiRunner, asked: string, seen: string) {
  const started = Date.now();
  const output = await ai.run(SUBJECT_MODEL, {
    messages: [{ role: "system", content: COMPARE }, { role: "user", content: `Asked for: ${asked}\nThe picture shows: ${seen}` }],
    response_format: { type: "json_schema", json_schema: SAME_SCHEMA },
    temperature: 0,
    max_tokens: 20,
  });
  const same = (answerOf(output) as { same?: unknown } | null)?.same;
  if (typeof same !== "boolean") throw new Error("The text model didn't say whether the picture shows the object.");
  return { same, ms: Date.now() - started };
}
