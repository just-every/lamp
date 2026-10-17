export function isPublicComponentShown(component: { onlyShowIfDegraded?: boolean; state: string }) {
  return !component.onlyShowIfDegraded || component.state !== "Operational";
}
