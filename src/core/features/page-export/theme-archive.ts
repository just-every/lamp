import type { BlobStore } from "../../platform/blobs/store";
import { createUlid } from "../../shared/ids";
import { pageThemeSchema, themeAssetsSchema, type ThemeAsset } from "../../shared/page-theme";
import { validateThemeAsset } from "../page-settings/theme-assets";
import { validatePageTheme } from "../page-settings/theme-validation";
import { pageDataFileSchema, type PageDataFile } from "./format";

type Page = PageDataFile["page"];
type ArchivedAsset = NonNullable<Page["themeAssets"]>[number];

function encode(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  return btoa(binary);
}

function decode(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

/** Theme bytes travel with the page data file; private object-store keys never do. */
export async function exportThemeArchive(blobs: BlobStore, rawTheme: string, rawAssets: string) {
  const theme = pageThemeSchema.nullable().parse(JSON.parse(rawTheme));
  const assets = themeAssetsSchema.parse(JSON.parse(rawAssets));
  const themeAssets: ArchivedAsset[] = [];
  for (const asset of assets) {
    const object = await blobs.getBytes(asset.key);
    if (!object) throw new Error(`The uploaded theme asset ${asset.path} is missing from storage.`);
    themeAssets.push(pageDataFileSchema.shape.page.shape.themeAssets.unwrap().element.parse({ path: asset.path, kind: asset.kind, contentType: asset.contentType, base64: encode(object.bytes) }));
  }
  return { theme, themeAssets };
}

/** A check does every safety validation before a restore can write a blob or row. */
export function validateThemeArchive(page: Page) {
  const assets: ThemeAsset[] = [];
  const prepared: { asset: ThemeAsset; bytes: ArrayBuffer }[] = [];
  const paths = new Set<string>();
  for (const archived of page.themeAssets ?? []) {
    if (paths.has(archived.path)) throw new Error(`The theme asset ${archived.path} appears more than once.`);
    paths.add(archived.path);
    const bytes = decode(archived.base64);
    const validated = validateThemeAsset(bytes, archived.contentType, archived.kind);
    const extension = archived.path.split(".").at(-1);
    const matches = validated.contentType === "image/jpeg" ? extension === "jpg" || extension === "jpeg" : extension === validated.extension;
    if (!matches || archived.contentType !== validated.contentType) throw new Error(`The theme asset ${archived.path} does not match its file type.`);
    const asset: ThemeAsset = { path: archived.path, key: `branding/theme/${createUlid()}.${validated.extension}`, contentType: validated.contentType, kind: archived.kind };
    assets.push(asset);
    prepared.push({ asset, bytes });
  }
  const result = validatePageTheme(page.theme ?? null, assets);
  if (result.removals.length) throw new Error(`The theme markup needs sanitization: ${result.removals.join("; ")}. Save the theme in Settings before exporting it.`);
  return { theme: result.theme, assets, prepared };
}

export async function restoreThemeArchive(page: Page, blobs: BlobStore) {
  const { theme, assets, prepared } = validateThemeArchive(page);
  const written: string[] = [];
  try {
    for (const { asset, bytes } of prepared) {
      await blobs.putBytes(asset.key, bytes, asset.contentType);
      written.push(asset.key);
    }
  } catch (error) {
    await Promise.all(written.map((key) => blobs.delete(key)));
    throw error;
  }
  return { theme, assets, written };
}
