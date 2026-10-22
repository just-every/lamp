/** The one image model the house style draws with, FLUX.2 [dev] through the install's Workers AI binding, and its
 *  published price (developers.cloudflare.com/workers-ai/platform/pricing, read 21 Oct 2026). The L18 bake-off chose
 *  it: the only model that kept one manner across accounts from a single reference picture. */

/** The one method of the Workers AI binding this feature uses: `env.AI` on an install. */
export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  /** The house style reference, smaller than 512×512 as FLUX.2 requires. */
  reference: { bytes: Uint8Array<ArrayBuffer>; contentType: string; width: number; height: number };
}

export const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-dev";
export const IMAGE_MODEL_NAME = "FLUX.2 [dev]";
const STEPS = 25;

/** 512×512 tiles by area, as Workers AI bills them (checked against the account's own neuron counts, 21 Oct 2026). */
const tiles = (width: number, height: number) => (width * height) / (512 * 512);

/** FLUX.2 takes multipart form data; a Response serialises it with its boundary. */
export function imageInputs(request: ImageRequest) {
  const form = new FormData();
  form.append("prompt", request.prompt);
  form.append("width", String(request.width));
  form.append("height", String(request.height));
  form.append("seed", String(request.seed));
  form.append("steps", String(STEPS));
  form.append("input_image_0", new Blob([request.reference.bytes], { type: request.reference.contentType }), "house-style.png");
  const serialised = new Response(form);
  return { multipart: { body: serialised.body, contentType: serialised.headers.get("content-type") } };
}

/** USD for one picture at this request's size and steps, from the published prices. */
export function imagePrice(request: ImageRequest) {
  return STEPS * (tiles(request.width, request.height) * 0.00041 + tiles(request.reference.width, request.reference.height) * 0.00021);
}

function sniff(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[8] === 0x57) return "image/webp";
  return null;
}

/** The image bytes from whatever the model returned: `{ image: base64 }` or the bytes themselves. */
export async function imageFrom(output: unknown): Promise<{ bytes: Uint8Array; contentType: string }> {
  let bytes: Uint8Array | null = null;
  if (output instanceof ReadableStream) bytes = new Uint8Array(await new Response(output).arrayBuffer());
  else if (output instanceof ArrayBuffer) bytes = new Uint8Array(output);
  else if (output instanceof Uint8Array) bytes = output;
  else if (output && typeof (output as { image?: unknown }).image === "string") bytes = Uint8Array.from(atob((output as { image: string }).image), (character) => character.charCodeAt(0));
  const contentType = bytes ? sniff(bytes) : null;
  if (!bytes || !contentType) throw new Error("The image model returned no image.");
  return { bytes, contentType };
}
