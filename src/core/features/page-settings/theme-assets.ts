import type { BlobStore } from "../../platform/blobs/store";
import { createUlid, nowIso } from "../../shared/ids";
import { sanitizeThemeHtml } from "./theme-html";
import { themeSchema } from "../../shared/page-theme";
import type { PageSettingsRepository } from "./repository";

export type ThemeAssetKind = "font" | "header";
export type ThemeAssets = Partial<Record<ThemeAssetKind, { key: string; contentType: string }>>;

function validatedType(kind: ThemeAssetKind, bytes: ArrayBuffer, contentType: string) {
  const data = new Uint8Array(bytes);
  const signature = (offset: number, text: string) => [...text].every((character, index) => data[offset + index] === character.charCodeAt(0));
  if (!data.length || data.length > (kind === "font" ? 512 * 1024 : 2 * 1024 * 1024)) throw new Error(`${kind} file is empty or too large.`);
  if (kind === "font") {
    if (data.length < 48 || !signature(0, "wOF2") || new DataView(bytes).getUint32(8) !== data.length) throw new Error("Font must be a valid WOFF2 file.");
    return "font/woff2";
  }
  const valid = contentType === "image/png" ? signature(0, "\x89PNG\r\n\x1a\n") : contentType === "image/jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255 : contentType === "image/webp" && signature(0, "RIFF") && signature(8, "WEBP");
  if (!valid) throw new Error("Header must be a PNG, JPEG or WebP image.");
  return contentType;
}

export function createThemeAssetsService<T>(repository: PageSettingsRepository, blobs: BlobStore | undefined, rebuild: () => Promise<T>) {
  return {
    async upload(kind: ThemeAssetKind, input: { bytes: ArrayBuffer; contentType: string }) {
      if (!blobs) throw new Error("Theme asset storage is not configured.");
      const contentType = validatedType(kind, input.bytes, input.contentType);
      const existing = await repository.get();
      if (!existing) throw new Error("Page settings are not configured.");
      const theme = themeSchema.parse(JSON.parse(existing.theme));
      const assets = JSON.parse(existing.themeAssets) as ThemeAssets;
      const key = `branding/theme/${createUlid()}`;
      await blobs.putBytes(key, input.bytes, contentType);
      assets[kind] = { key, contentType };
      if (kind === "font") theme.font = "uploaded";
      else theme.headerImage = true;
      await repository.updateThemeAssets({ theme: JSON.stringify(theme), themeAssets: JSON.stringify(assets), updatedAt: nowIso() });
      return rebuild();
    },
    async remove(kind: ThemeAssetKind) {
      const existing = await repository.get();
      if (!existing) throw new Error("Page settings are not configured.");
      const theme = themeSchema.parse(JSON.parse(existing.theme));
      const assets = JSON.parse(existing.themeAssets) as ThemeAssets;
      delete assets[kind];
      if (kind === "font") theme.font = "default";
      else {
        theme.headerImage = false;
        const options = { origin: `https://${existing.hostname}`, imagePaths: existing.logoKey ? ["/assets/logo"] : [] };
        theme.headerHtml = sanitizeThemeHtml(theme.headerHtml, "headerHtml", options).html;
        theme.footerHtml = sanitizeThemeHtml(theme.footerHtml, "footerHtml", options).html;
      }
      await repository.updateThemeAssets({ theme: JSON.stringify(theme), themeAssets: JSON.stringify(assets), updatedAt: nowIso() });
      return rebuild();
    },
  };
}
