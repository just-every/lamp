import './search.css';

/** Static markup; the standalone site's client enhances each instance. */
export function SearchField({ id, endpoint = '/docs/search' }: { id: string; endpoint?: string }) {
  return <div className="docs-search" data-docs-search data-endpoint={endpoint}>
    <label className="docs-search-label" htmlFor={id}>Search docs</label>
    <div className="docs-search-field">
      <input id={id} type="search" placeholder="Search docs" autoComplete="off" spellCheck={false}
        role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false"
        aria-controls={`${id}-results`} aria-describedby={`${id}-status`} />
      <kbd aria-hidden="true">/</kbd>
    </div>
    <div className="docs-search-panel" data-search-panel hidden>
      <p id={`${id}-status`} className="docs-search-status" role="status" aria-live="polite" aria-atomic="true">Search the docs</p>
      <ul id={`${id}-results`} className="docs-search-results" role="listbox" aria-label="Search results" hidden />
    </div>
  </div>;
}
