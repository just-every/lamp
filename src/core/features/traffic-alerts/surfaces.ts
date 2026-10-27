/** Public read surfaces Lamp counts, and the one place their owner-facing names live. */
export const TRAFFIC_SURFACES = ['page', 'history', 'incident', 'maintenance', 'feed', 'widget', 'status', 'asset', 'badge', 'component', 'public-api'] as const;
export type TrafficSurface = typeof TRAFFIC_SURFACES[number];
export const trafficSurfaceNames: Record<TrafficSurface, string> = {
  page: 'status page', history: 'history', incident: 'incident pages', maintenance: 'maintenance', feed: 'feeds', widget: 'widget',
  status: 'status data', asset: 'page files', badge: 'badges', component: 'component pages', 'public-api': 'public API',
};
