const SECTIONS = [
  ['status-page', 'Status page'], ['updates', 'Updates'], ['resilience', 'Resilience'], ['subscribers', 'Subscribers'],
  ['history', 'History'], ['maintenance', 'Maintenance'], ['ownership', 'Ownership'],
] as const;

// The docs footer's index of the landing page's sections, in page order. The landing page's own footer has none: its sections
// are on the page the visitor is already reading.
export function FooterIndex() {
  return <nav className="lamp-footer__index" aria-label="Lamp">
    {SECTIONS.map(([id, label]) => <a key={id} href={`/#${id}`}>{label}</a>)}
  </nav>;
}
