import jpeg from "jpeg-js";

/** The object cut from the model's picture, so every account's object sits on its page at one size and place.
 *  The model draws on pure white; the page multiplies the cut-out onto the account's band and draws the light. */
export interface MomentPicture {
  bytes: Uint8Array;
  contentType: "image/jpeg";
  width: number;
  height: number;
  /** Where a hanging object's cord meets it, as a share of the cut-out's width; null when it stands. */
  cordX: number | null;
  /** The model's picture: its size, the object's box in it and how white its edges were (255 is pure white). */
  source: { width: number; height: number; box: { x: number; y: number; width: number; height: number }; edgeWhite: number };
  /** The palest the cut-out's own edge gets, darkest channel: 255 when the feathered margin reaches pure white. */
  cutEdge: number;
}

/** A pixel whose darkest channel is below this belongs to the object, its shadow or its light. */
const OBJECT_BELOW = 236;
const EDGE = 16;
/** The margin kept around the object's box, as a share of its larger side. */
const MARGIN = 0.06;
/** A cut-out edge darker than this would show its box on the stone, as the first pictures' did (L18). */
const WHITE_EDGE = 245;

/** Fades the margin around the object's box to pure white (smoothstep from the box out to the crop's edge), so the
 *  page's multiply leaves no box edge where an object's shadow reached the crop. A hanging object keeps its top
 *  edge, where its cord meets the page's own cord. */
function feather(crop: Uint8Array, size: { width: number; height: number }, origin: { x: number; y: number }, box: { left: number; top: number; right: number; bottom: number }, margin: number, hanging: boolean) {
  const span = Math.max(1, margin);
  for (let y = 0; y < size.height; y += 1) {
    const sourceY = origin.y + y;
    const vertical = Math.max(sourceY - box.bottom, hanging ? 0 : box.top - sourceY, 0) / span;
    for (let x = 0; x < size.width; x += 1) {
      const sourceX = origin.x + x;
      const t = Math.min(1, Math.max(vertical, Math.max(box.left - sourceX, sourceX - box.right, 0) / span));
      if (t === 0) continue;
      const keep = 1 - t * t * (3 - 2 * t);
      const at = (y * size.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) crop[at + channel] = Math.round(255 - (255 - crop[at + channel]!) * keep);
    }
  }
}

export function cutOut(input: Uint8Array, placement: "hanging" | "standing"): MomentPicture {
  const { width, height, data } = jpeg.decode(input, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 6, maxMemoryUsageInMB: 96 });
  const darkest = (x: number, y: number) => { const at = (y * width + x) * 4; return Math.min(data[at]!, data[at + 1]!, data[at + 2]!); };
  let sum = 0, count = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const frame = x < EDGE || x >= width - EDGE || y >= height - EDGE || (y < EDGE && placement === "standing");
    if (frame) { sum += darkest(x, y); count += 1; }
  }
  const edgeWhite = sum / count;
  if (edgeWhite < WHITE_EDGE) throw new Error(`The picture's background isn't white at its edges (${edgeWhite.toFixed(0)} of 255), so it can't sit on the page.`);
  const rows = new Uint32Array(height), columns = new Uint32Array(width);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (darkest(x, y) < OBJECT_BELOW) { rows[y] += 1; columns[x] += 1; }
  // A cord is a thin run at the top; the object starts where a row is wider than a cord can be.
  const noise = Math.max(3, Math.round(width * 0.004));
  const body = placement === "hanging" ? Math.round(width * 0.03) : noise;
  const top = rows.findIndex((value) => value >= body);
  const bottom = rows.findLastIndex((value) => value >= noise);
  const left = columns.findIndex((value) => value >= noise);
  const right = columns.findLastIndex((value) => value >= noise);
  if (top < 0 || bottom <= top || left < 0 || right <= left) throw new Error("The picture has no object in it.");
  if (left < EDGE / 2 || right >= width - EDGE / 2 || bottom >= height - EDGE / 2 || (placement === "standing" && top < EDGE / 2)) throw new Error("The picture's object runs off its edge.");
  const margin = Math.round(Math.max(right - left, bottom - top) * MARGIN);
  const x0 = Math.max(0, left - margin), x1 = Math.min(width, right + margin + 1);
  const y0 = Math.max(0, top - margin), y1 = Math.min(height, bottom + margin + 1);
  let cordX: number | null = null;
  if (placement === "hanging") {
    let total = 0, pixels = 0;
    for (let y = 0; y < top; y += 1) for (let x = x0; x < x1; x += 1) if (darkest(x, y) < OBJECT_BELOW) { total += x; pixels += 1; }
    if (pixels >= top * 0.5) cordX = (total / pixels - x0) / (x1 - x0);
  }
  const cropWidth = x1 - x0, cropHeight = y1 - y0;
  const crop = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) crop.set(data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x1) * 4), y * cropWidth * 4);
  feather(crop, { width: cropWidth, height: cropHeight }, { x: x0, y: y0 }, { left, top, right, bottom }, margin, placement === "hanging");
  let cutEdge = 255;
  const edgeOf = (x: number, y: number) => { const at = (y * cropWidth + x) * 4; cutEdge = Math.min(cutEdge, crop[at]!, crop[at + 1]!, crop[at + 2]!); };
  for (let x = 0; x < cropWidth; x += 1) { if (placement === "standing") edgeOf(x, 0); edgeOf(x, cropHeight - 1); }
  for (let y = 0; y < cropHeight; y += 1) { edgeOf(0, y); edgeOf(cropWidth - 1, y); }
  if (cutEdge < WHITE_EDGE) throw new Error(`The cut-out's edge isn't white (${cutEdge} of 255), so its box would show on the page.`);
  const encoded = jpeg.encode({ data: crop, width: cropWidth, height: cropHeight }, 90).data;
  return {
    bytes: new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength),
    contentType: "image/jpeg",
    width: cropWidth,
    height: cropHeight,
    cordX,
    source: { width, height, box: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, edgeWhite: Math.round(edgeWhite * 10) / 10 },
    cutEdge,
  };
}
