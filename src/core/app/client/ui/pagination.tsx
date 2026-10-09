import { Button } from "./button";

export function ListPagination({
  label,
  offset,
  shown,
  hasMore,
  onPrevious,
  onNext,
}: {
  label: string;
  offset: number;
  shown: number;
  hasMore: boolean;
  onPrevious(): void;
  onNext(): void;
}) {
  if (shown === 0 && offset === 0) return null;
  const first = offset + 1;
  const last = offset + shown;
  return <nav className="list-pagination" aria-label={`${label} pagination`}>
    <span aria-live="polite">Showing {first}–{last}</span>
    <div>
      <Button type="button" variant="secondary" disabled={offset === 0} onClick={onPrevious}>Previous</Button>
      <Button type="button" variant="secondary" disabled={!hasMore} onClick={onNext}>Next</Button>
    </div>
  </nav>;
}
