/** Rectangles are viewport pixels; clipping also limits the iframe's pointer hit area. */
export type SurfaceRegion = { x: number; y: number; width: number; height: number };
export function validSurface(value: Record<string, unknown>) {
  const viewport = value.viewport as Record<string, unknown> | undefined;
  return !!viewport && Object.keys(viewport).sort().join(',') === 'height,width'
    && [viewport.width, viewport.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 32000)
    && Array.isArray(value.regions) && value.regions.length <= 64 && value.regions.every(region =>
      region && typeof region === 'object' && Object.keys(region).sort().join(',') === 'height,width,x,y'
      && [region.x, region.y, region.width, region.height].every(n => typeof n === 'number' && Number.isFinite(n))
      && region.width > 0 && region.height > 0 && region.x >= 0 && region.y >= 0
      && region.x + region.width <= Number(viewport.width) + 1 && region.y + region.height <= Number(viewport.height) + 1);
}
export function surfaceClip(regions: SurfaceRegion[]) {
  return regions.length ? `path("${regions.map(({x,y,width,height}) => `M ${x} ${y} h ${width} v ${height} h ${-width} Z`).join(' ')}")` : 'inset(100%)';
}
