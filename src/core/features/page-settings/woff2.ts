/** Structural WOFF2 validation before an uploaded font can become a page asset (WOFF2 Recommendation, §3–5). */
export function validWoff2(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  if (data.length < 48) return false;
  const view = new DataView(bytes);
  const tag = (at: number) => String.fromCharCode(...data.subarray(at, at + 4));
  const flavour = view.getUint32(4);
  if (tag(0) !== "wOF2" || ![0x00010000, 0x4f54544f, 0x74727565, 0x74746366].includes(flavour)
    || view.getUint32(8) !== data.length || !view.getUint16(12) || view.getUint16(14) !== 0
    || !view.getUint32(16) || !view.getUint32(20)) return false;
  let cursor = 48;
  function byte() {
    if (cursor >= data.length) throw new Error("Truncated WOFF2 directory");
    return data[cursor++];
  }
  function base128() {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      const next = byte();
      if (!index && next === 0x80) throw new Error("Noncanonical WOFF2 length");
      value = value * 128 + (next & 0x7f);
      if (value > 0xffffffff) throw new Error("WOFF2 length overflow");
      if (!(next & 0x80)) return value;
    }
    throw new Error("Invalid WOFF2 length");
  }
  function uint255() {
    const first = byte();
    if (first === 253) return byte() * 256 + byte();
    return first === 254 ? byte() + 506 : first === 255 ? byte() + 253 : first;
  }
  try {
    const count = view.getUint16(12);
    const tags = new Set<string>();
    let sfntSize = 12 + count * 16;
    let transformedGlyf = false, transformedLoca = false;
    for (let index = 0; index < count; index++) {
      const flags = byte();
      const knownTag = flags & 63;
      const version = flags >>> 6;
      let name = String(knownTag);
      if (knownTag === 63) {
        if (cursor + 4 > data.length) return false;
        name = tag(cursor); cursor += 4;
      }
      if (flavour !== 0x74746366 && tags.has(name)) return false;
      tags.add(name);
      const length = base128();
      sfntSize += Math.ceil(length / 4) * 4;
      const glyf = knownTag === 10 || name === "glyf";
      const loca = knownTag === 11 || name === "loca";
      const hmtx = knownTag === 3 || name === "hmtx";
      if (glyf || loca) {
        if (version !== 0 && version !== 3) return false;
      } else if (hmtx ? version > 1 : version !== 0) return false;
      const transformed = glyf || loca ? version === 0 : version !== 0;
      if (transformed) {
        const transformLength = base128();
        if (loca && transformLength !== 0) return false;
        if (!loca && !transformLength) return false;
      }
      if (glyf) transformedGlyf = transformed;
      if (loca) transformedLoca = transformed;
    }
    if (transformedGlyf !== transformedLoca) return false;
    if (flavour === 0x74746366) {
      if (cursor + 4 > data.length) return false;
      const version = view.getUint32(cursor); cursor += 4;
      if (version !== 0x00010000 && version !== 0x00020000) return false;
      const fonts = uint255();
      if (!fonts) return false;
      for (let font = 0; font < fonts; font++) {
        const tables = uint255();
        if (!tables || cursor + 4 > data.length) return false;
        cursor += 4;
        for (let table = 0; table < tables; table++) if (uint255() >= count) return false;
      }
    } else if (sfntSize !== view.getUint32(16)) return false;
    const compressedEnd = cursor + view.getUint32(20);
    if (compressedEnd > data.length) return false;
    const metaOffset = view.getUint32(28), metaLength = view.getUint32(32), metaOriginal = view.getUint32(36);
    const privateOffset = view.getUint32(40), privateLength = view.getUint32(44);
    if (metaOffset ? !metaLength || !metaOriginal || metaOffset < compressedEnd || metaOffset + metaLength > data.length : metaLength || metaOriginal) return false;
    if (privateOffset ? !privateLength || privateOffset < compressedEnd || privateOffset + privateLength > data.length : privateLength) return false;
    if (metaOffset && privateOffset && metaOffset < privateOffset + privateLength && privateOffset < metaOffset + metaLength) return false;
    return true;
  } catch { return false; }
}
