/** A mark (SVG or raster, as a data: or blob: URL) drawn into a square PNG in the browser, so Lamp stores
 * only raster logos. SVG drawn through an image runs no scripts. Vectors render at 512px; rasters keep
 * their own size (64-512px) rather than being blown up. */
export async function markToPng(source: string, vector: boolean): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const width = image.naturalWidth || 512, height = image.naturalHeight || 512;
  const size = vector ? 512 : Math.min(512, Math.max(64, width, height));
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const scale = Math.min(size / width, size / height);
  canvas.getContext("2d")!.drawImage(image, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The mark could not be drawn.")), "image/png"));
}

export const isVectorMark = (contentType: string) => contentType === "image/svg+xml";

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

/** Store a mark as the page logo; the public page, favicon and social image are rebuilt from it. */
export async function uploadMark(png: Blob) {
  const form = new FormData();
  form.set("logo", new File([png], "mark.png", { type: "image/png" }));
  const response = await fetch("/api/app/page-settings/logo", { method: "POST", body: form, headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null) as { settings?: unknown; error?: string } | null;
  if (!response.ok || !body?.settings) throw new Error(body?.error ?? "The logo could not be saved.");
  return body.settings;
}
