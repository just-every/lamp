// COMP-002: operators order groups, and components within each group; every
// surface that lists components shows them in the public page's order. Display
// orders are per group, so a component's own order is only meaningful after its
// group's order. Ungrouped components follow every group, under one heading.

export const UNGROUPED_COMPONENTS_HEADING = "Other services";

export interface OrderableComponent {
  name: string;
  groupName: string | null;
  groupOrder: number | null;
  displayOrder: number;
}

function groupOrder(component: OrderableComponent) {
  return component.groupOrder ?? Number.MAX_SAFE_INTEGER;
}

export function compareComponentOrder(left: OrderableComponent, right: OrderableComponent) {
  return groupOrder(left) - groupOrder(right) || left.displayOrder - right.displayOrder || left.name.localeCompare(right.name);
}

export function sortComponentsByOrder<T extends OrderableComponent>(components: readonly T[]): T[] {
  return [...components].sort(compareComponentOrder);
}

/** Components in public page sections: one section per group heading, in order. */
export function groupComponentsByHeading<T extends OrderableComponent>(components: readonly T[]): Array<[heading: string, components: T[]]> {
  const sections = new Map<string, T[]>();
  for (const component of sortComponentsByOrder(components)) {
    const heading = component.groupName ?? UNGROUPED_COMPONENTS_HEADING;
    sections.set(heading, [...(sections.get(heading) ?? []), component]);
  }
  return [...sections.entries()];
}

/** The order in which the public page lists components, top to bottom. */
export function publicComponentOrder<T extends OrderableComponent>(components: readonly T[]): T[] {
  return groupComponentsByHeading(components).flatMap(([, section]) => section);
}
