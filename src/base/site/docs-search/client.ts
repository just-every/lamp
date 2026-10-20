type SearchResult = { href: string; titlePath: string[]; snippet: string; score: number };
const mounted = new WeakMap<HTMLElement, () => void>();

function readResults(payload: unknown): SearchResult[] {
  if (!payload || typeof payload !== 'object' || !('results' in payload) || !Array.isArray(payload.results)) {
    throw new Error('Invalid search response');
  }
  return payload.results.slice(0, 5).map((value: unknown) => {
    if (!value || typeof value !== 'object' || !('href' in value) || typeof value.href !== 'string'
      || !('titlePath' in value) || !Array.isArray(value.titlePath) || !value.titlePath.every((part: unknown) => typeof part === 'string')
      || !('snippet' in value) || typeof value.snippet !== 'string'
      || !('score' in value) || typeof value.score !== 'number' || !Number.isFinite(value.score)) {
      throw new Error('Invalid search result');
    }
    const url = new URL(value.href, document.baseURI);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid search link');
    return { href: url.href, titlePath: value.titlePath, snippet: value.snippet, score: value.score };
  });
}

function mount(root: HTMLElement): () => void {
  const input = root.querySelector<HTMLInputElement>('input[type="search"]');
  const panel = root.querySelector<HTMLElement>('[data-search-panel]');
  const list = root.querySelector<HTMLUListElement>('[role="listbox"]');
  const status = root.querySelector<HTMLElement>('[role="status"]');
  if (!input || !panel || !list || !status) throw new Error('Incomplete docs search field');
  const address = root.dataset.endpoint;
  if (!address) throw new Error('Docs search endpoint is missing');
  const baseEndpoint = new URL(address, document.baseURI);
  const listeners = new AbortController();
  let request: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let links: HTMLAnchorElement[] = [];
  let active = -1;
  let renderedQuery: string | undefined;

  function cancel() {
    revision += 1;
    clearTimeout(timer);
    timer = undefined;
    request?.abort();
    request = undefined;
    list!.removeAttribute('aria-busy');
  }
  function select(index: number) {
    active = index;
    links.forEach((link, position) => link.setAttribute('aria-selected', String(position === active)));
    if (links[active]) input!.setAttribute('aria-activedescendant', links[active].id);
    else input!.removeAttribute('aria-activedescendant');
  }
  function close() {
    cancel();
    panel!.hidden = true;
    input!.setAttribute('aria-expanded', 'false');
    select(-1);
  }
  function message(text: string) {
    links = [];
    select(-1);
    list!.replaceChildren();
    list!.hidden = true;
    status!.textContent = text;
  }
  function show() {
    panel!.hidden = false;
    input!.setAttribute('aria-expanded', 'true');
  }
  function render(results: SearchResult[]) {
    message(results.length ? '' : 'No results');
    const fragment = document.createDocumentFragment();
    links = results.map((result, index) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'none');
      const link = document.createElement('a');
      link.id = `${list!.id}-${index}`;
      link.href = result.href;
      link.tabIndex = -1;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', 'false');
      const title = document.createElement('span');
      title.className = 'docs-search-result-title';
      title.textContent = result.titlePath.join(' > ');
      const snippet = document.createElement('span');
      snippet.className = 'docs-search-result-snippet';
      snippet.textContent = result.snippet;
      link.appendChild(title);
      link.appendChild(snippet);
      item.appendChild(link);
      fragment.appendChild(item);
      return link;
    });
    list!.appendChild(fragment);
    list!.hidden = !links.length;
  }
  function search() {
    cancel();
    show();
    renderedQuery = undefined;
    const query = input!.value.trim();
    if (query.length < 2) { message('Search the docs'); return; }
    message('Searching…');
    const current = revision;
    timer = setTimeout(async () => {
      const controller = new AbortController();
      request = controller;
      list!.setAttribute('aria-busy', 'true');
      try {
        const endpoint = new URL(baseEndpoint);
        endpoint.searchParams.set('q', query);
        const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Search request failed');
        const results = readResults(await response.json());
        if (current !== revision || controller.signal.aborted) return;
        renderedQuery = query;
        render(results);
      } catch {
        if (current === revision && !controller.signal.aborted) message('Search unavailable');
      } finally {
        if (current === revision) {
          request = undefined;
          list!.removeAttribute('aria-busy');
        }
      }
    }, 240);
  }
  const options = { signal: listeners.signal };
  input.addEventListener('input', search, options);
  input.addEventListener('focus', () => {
    if (renderedQuery === input.value.trim()) show();
    else search();
  }, options);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (panel.hidden && renderedQuery !== input.value.trim()) search();
      else show();
      if (links.length) {
        const next = active < 0 ? (event.key === 'ArrowDown' ? 0 : links.length - 1)
          : (active + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        select(next);
        links[next].scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'Enter' && !panel.hidden && links.length) {
      event.preventDefault();
      links[active < 0 ? 0 : active].click();
    }
  }, options);
  list.addEventListener('pointerdown', event => event.preventDefault(), options);
  list.addEventListener('pointerover', event => {
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    const index = links.findIndex(link => link === target);
    if (index >= 0) select(index);
  }, options);
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && !root.contains(event.target)) close();
  }, options);
  document.addEventListener('focusin', event => {
    if (event.target instanceof Node && !root.contains(event.target)) close();
  }, options);
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const details = root.closest('details');
    if (!input.getClientRects().length && !(details && !details.open && details.getClientRects().length)) return;
    event.preventDefault();
    if (details) details.open = true;
    input.focus();
    input.select();
  }, options);
  return () => { close(); listeners.abort(); mounted.delete(root); };
}

/** Idempotent enhancement; cleanup only removes instances created by this call. */
export function initDocsSearch(scope: ParentNode = document): () => void {
  const roots = Array.from(scope.querySelectorAll<HTMLElement>('[data-docs-search]'));
  if (scope instanceof HTMLElement && scope.matches('[data-docs-search]')) roots.unshift(scope);
  const cleanups: (() => void)[] = [];
  for (const root of roots) {
    if (mounted.has(root)) continue;
    const cleanup = mount(root);
    mounted.set(root, cleanup);
    cleanups.push(cleanup);
  }
  return () => cleanups.forEach(cleanup => cleanup());
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initDocsSearch(), { once: true });
  else initDocsSearch();
}
