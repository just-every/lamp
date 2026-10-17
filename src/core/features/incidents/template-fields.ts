export const TEMPLATE_WORDING_FIELDS = {
  affectedAudience: { label: "Who is affected", max: 250 },
  customerImpact: { label: "Customer impact", max: 250 },
  whatStillWorks: { label: "What still works", max: 250 },
  details: { label: "Details", max: 500 },
} as const;

export type TemplateWordingField = keyof typeof TEMPLATE_WORDING_FIELDS;
export type TemplateWording = Record<TemplateWordingField, string>;

export function templateFieldsToShorten(wording: TemplateWording): TemplateWordingField[] {
  return (Object.keys(TEMPLATE_WORDING_FIELDS) as TemplateWordingField[])
    .filter(field => wording[field].length > TEMPLATE_WORDING_FIELDS[field].max);
}

export function assertTemplateWordingLimits(wording: TemplateWording) {
  const fields = templateFieldsToShorten(wording);
  if (fields.length) throw new Error(`Shorten these template fields before applying: ${fields.map(field => `${TEMPLATE_WORDING_FIELDS[field].label} (${wording[field].length}/${TEMPLATE_WORDING_FIELDS[field].max})`).join(", ")}.`);
}
