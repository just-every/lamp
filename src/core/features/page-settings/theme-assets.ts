import type { ThemeAsset } from "../../shared/page-theme";

export class InvalidThemeError extends Error {}

const TYPES = {
  "font/woff2": { extension: "woff2", kind: "font" },
  "image/png": { extension: "png", kind: "image" },
  "image/jpeg": { extension: "jpg", kind: "image" },
  "image/webp": { extension: "webp", kind: "image" },
} as const;

/** Uploaded themes use the same bounded image storage as the existing brand logo. SVG is not an upload format. */
export function validateThemeAsset(bytes: ArrayBuffer, contentType: string, kind: ThemeAsset["kind"]) {
  const type = TYPES[contentType as keyof typeof TYPES];
  if (!type || type.kind !== kind) throw new InvalidThemeError(kind === "font" ? "Upload a WOFF2 font." : "Upload a PNG, JPEG or WebP image.");
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) throw new InvalidThemeError("Theme assets must be between 1 byte and 2 MB.");
  const data = new Uint8Array(bytes);
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  const valid = contentType === "font/woff2" ? data.length >= 48 && ascii(0, 4) === "wOF2" && new DataView(bytes).getUint32(8) === data.length
    : contentType === "image/png" ? data.length >= 24 && data[0] === 137 && ascii(1, 4) === "PNG" && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10 && ascii(12, 16) === "IHDR"
      : contentType === "image/jpeg" ? data.length >= 4 && data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217
        : data.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!valid) throw new InvalidThemeError(`The uploaded file is not a valid ${type.extension.toUpperCase()} asset.`);
  return { extension: type.extension, contentType };
}
