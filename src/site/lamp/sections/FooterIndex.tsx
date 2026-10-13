const SECTIONS = [
  ['status-page', 'Status page'], ['updates', 'Updates'], ['resilience', 'Resilience'], ['subscribers', 'Subscribers'],
  ['history', 'History'], ['maintenance', 'Maintenance'], ['ownership', 'Ownership'],
] as const;

// The footer's index of the page's sections, in page order; on the landing page PageMotion makes them glide. Away from the
// landing page (the docs) the same links lead to its sections.
export function FooterIndex({ onDocs = false }: { onDocs?: boolean }) {
  return <nav className="lamp-footer__index" aria-label={onDocs ? 'Lamp' : 'On this page'}>
    {SECTIONS.map(([id, label]) => onDocs ? <a key={id} href={`/#${id}`}>{label}</a> : <a key={id} href={`#${id}`}>{label}</a>)}
  </nav>;
}
