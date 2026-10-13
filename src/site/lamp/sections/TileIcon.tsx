// The small line icons over the "Already wired in" tiles: 24px, a 1.5px stroke with round caps, in the caption's
// quieter ink. Decorative: each tile's caption says what it is.
export type TileIconName = 'report' | 'alerts' | 'webhooks' | 'deliveries' | 'domain' | 'subscribe';

const PATHS: Record<TileIconName, string> = {
  report: 'M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5',
  alerts: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  webhooks: 'M4 8h14 M14 4l4 4-4 4 M20 16H6 M10 12l-4 4 4 4',
  deliveries: 'M21 3 3 10.5l7.5 3L14 21z M10.5 13.5 21 3',
  domain: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c-2.8 3-2.8 15 0 18 M12 3c2.8 3 2.8 15 0 18',
  subscribe: 'M3 6h18v12H3z M3 7l9 6 9-6',
};

export function TileIcon({ name }: { name: TileIconName }) {
  return <svg className="lamp-built__icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
