/** Restore individual longhands only while their value and priority remain ours. */
const longhands: Record<string,string[]> = {
  padding:['padding-top','padding-right','padding-bottom','padding-left'],
  margin:['margin-top','margin-right','margin-bottom','margin-left'],
  'border-color':['border-top-color','border-right-color','border-bottom-color','border-left-color'],
  'border-width':['border-top-width','border-right-width','border-bottom-width','border-left-width'],
  'border-radius':['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'],
  gap:['row-gap','column-gap'],
};
export function applyStyles(element: HTMLElement, styles: Record<string,string>) {
  for (const [name,value] of Object.entries(styles)) if (!CSS.supports(name,value)) throw new Error(`Unsupported style: ${name}`);
  const names = [...new Set(Object.keys(styles).flatMap(name => longhands[name] || [name]))];
  const read = (name: string) => ({value:element.style.getPropertyValue(name),priority:element.style.getPropertyPriority(name)});
  const before = new Map(names.map(name => [name,read(name)]));
  for (const [name,value] of Object.entries(styles)) element.style.setProperty(name,value);
  const applied = new Map(names.map(name => [name,read(name)]));
  return () => {
    for (const [name,original] of before) {
      const current = read(name), own = applied.get(name)!;
      if (current.value !== own.value || current.priority !== own.priority) continue;
      if (original.value) element.style.setProperty(name,original.value,original.priority); else element.style.removeProperty(name);
    }
  };
}
