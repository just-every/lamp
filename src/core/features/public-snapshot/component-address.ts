/** Immutable component IDs, rather than editable names, identify public resources. */
export function componentSlug(component: { id: string }) {
  return component.id.toLowerCase();
}

export function publicComponentResources(component: { id: string }) {
  const base = `/components/${encodeURIComponent(componentSlug(component))}`;
  return {
    atom: `${base}/feed.atom`,
    rss: `${base}/feed.rss`,
    badge: `${base}/badge.svg`,
    uptime: `${base}/uptime.svg`,
  };
}
