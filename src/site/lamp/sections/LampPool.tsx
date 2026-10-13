import './pool.css';

// The lamp's pool of light under a lit lamp; its className places it. Decorative.
export function LampPool({ className }: { className: string }) {
  return <span className={`lamp-pool ${className}`} aria-hidden="true" />;
}
