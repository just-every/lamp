/** The public page's few line icons, drawn like the operator app's (1.75px strokes on a 24px grid) and inlined so they
 *  cost no request. Each is decorative: the text beside it carries the meaning. */
const paths = {
  check: '<path d="m5.5 12.5 4.25 4.25L18.5 7.5"/>',
  alert: '<path d="M12 5.5v8"/><path d="M12 18.25h.01"/>',
  maintenance: '<circle cx="12" cy="12" r="7.75"/><path d="M12 8v4.25l2.75 1.75"/>',
};

export type PublicIcon = keyof typeof paths;

export function publicIcon(name: PublicIcon, className: string) {
  return `<span class="${className}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg></span>`;
}
