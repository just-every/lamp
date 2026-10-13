// The status page's two small glyphs, a circle with a tick and a circle with "!", drawn in ink.
export function Glyph({ kind }: { kind: 'check' | 'alert' }) {
  return <svg className="lamp-glyph" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">
    <circle cx="7" cy="7" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.3" />
    {kind === 'check'
      ? <path d="M4.2 7.2l1.9 1.9 3.8-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      : <><path d="M7 3.6v4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="7" cy="10.2" r=".9" fill="currentColor" /></>}
  </svg>;
}
