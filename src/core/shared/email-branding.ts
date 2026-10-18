import { z } from "zod";
import { renderUpdateHtml } from "./update-links";

const header = (length: number) => z.string().trim().max(length).regex(/^[^\x00-\x1f\x7f\u2028\u2029]*$/, "Email headers cannot contain control characters.");
export const emailBrandingSchema = z.object({
  displayName: header(120).refine(value => !/["<>\\]/.test(value), "Display name cannot contain quotes, angle brackets or backslashes.").default(""),
  replyTo: z.union([z.literal(""), z.email()]).default(""),
  subjectPrefix: header(80).default(""),
  header: z.string().trim().max(500).regex(/^[^\x00-\x08\x0b-\x1f\x7f]*$/).default(""),
  footer: z.string().trim().max(1000).regex(/^[^\x00-\x08\x0b-\x1f\x7f]*$/).default(""),
  usePageLogo: z.boolean().default(false),
}).strict();
export type EmailBranding = z.infer<typeof emailBrandingSchema>;
export const defaultEmailBranding = emailBrandingSchema.parse({});

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Shared notification content for delivery and the operator's email preview.
 * Personal management/unsubscribe links are appended by delivery, outside all
 * editable wording. No setting is interpreted as HTML or as a destination URL. */
export function brandEmail(email: { subject: string; plainText: string }, input: {
  branding: EmailBranding; pageName: string; fromAddress: string; origin: string; hasLogo: boolean;
}) {
  const { branding, pageName, fromAddress, origin, hasLogo } = input;
  const subject = [branding.subjectPrefix, `${pageName}: ${email.subject}`].filter(Boolean).join(" ");
  const from = branding.displayName ? `"${branding.displayName}" <${fromAddress}>` : fromAddress;
  const logoUrl = branding.usePageLogo && hasLogo ? new URL("/assets/logo", origin).href : undefined;
  const plainText = [pageName, branding.header, email.plainText, branding.footer].filter(Boolean).join("\n\n");
  const html = `<p><a href="${escape(new URL("/", origin).href)}">${escape(pageName)}</a></p>${logoUrl ? `<img src="${escape(logoUrl)}" alt="${escape(pageName)}" width="160" style="max-width:100%;height:auto">` : ""}${branding.header ? `<p>${renderUpdateHtml(branding.header)}</p>` : ""}<h1>${escape(email.subject)}</h1><pre>${renderUpdateHtml(email.plainText)}</pre>${branding.footer ? `<p>${renderUpdateHtml(branding.footer)}</p>` : ""}`;
  return { subject, plainText, html, from, ...(branding.replyTo ? { replyTo: branding.replyTo } : {}), ...(logoUrl ? { logoUrl, logoAlt: pageName } : {}) };
}
