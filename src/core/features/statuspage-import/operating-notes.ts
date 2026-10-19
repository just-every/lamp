/** How operating Lamp differs from Statuspage, shown in Cutover after a Statuspage
 * dry run or import (MOVE-009). Each note describes behaviour Lamp ships today. */
export const statuspageOperatingNotes = [
  "A published update is never edited in place. Fix a mistake with a correction update that names it, and publish it with no channels selected when nobody should be notified again. Both updates stay on the timeline.",
  "Component states change with each update: set each affected component's state in the update you publish, and publishing applies the states and the update together.",
  "Components set to show only while degraded keep that behaviour after import.",
] as const;
