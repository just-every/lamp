// A built-in template's page script. Everything it touches is readable without it (PAGE-002): it turns the generated
// instant into "Updated 2 minutes ago", refreshes the page's live parts when a newer snapshot is published (PAGE-014)
// and filters the Regions map's components in place.
(() => {
  const label = document.querySelector('[data-timezone-label]');
  const zone = (label && label.getAttribute('data-timezone')) || 'UTC';
  const format = (iso) => {
    const date = new Date(iso);
    const shown = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
    return `${shown} UTC${name === 'GMT' ? '+00:00' : (/^GMT([+-]\d{2}:\d{2})$/.exec(name || '') || [])[1] || ''}`;
  };
  const relative = () => {
    for (const time of document.querySelectorAll('[data-generated-at] time')) {
      const minutes = Math.floor(Math.max(0, Date.now() - Date.parse(time.dateTime)) / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
      time.title = format(time.dateTime);
      time.textContent = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `${days} day${days === 1 ? '' : 's'} ago`;
    }
  };

  let region = 'all';
  const filter = () => {
    const rows = [...document.querySelectorAll('.rg-row[data-region]')];
    if (!rows.length) return;
    for (const row of rows) row.hidden = region !== 'all' && row.getAttribute('data-region') !== region && row.getAttribute('data-region') !== '';
    for (const choice of document.querySelectorAll('[data-region-choice]')) {
      if (choice.getAttribute('data-region-choice') === region) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    }
    const table = document.querySelector('.rg-components');
    if (table) table.toggleAttribute('data-filtered', region !== 'all');
    const count = document.querySelector('[data-region-count]');
    const shown = rows.filter((row) => !row.hidden).length;
    const name = document.querySelector(`.rg-filters [data-region-choice="${region}"]`);
    if (count) count.textContent = region === 'all' ? `Showing all ${shown} component${shown === 1 ? '' : 's'}` : `Showing ${shown} component${shown === 1 ? '' : 's'} for ${name ? name.textContent : region}`;
  };
  document.addEventListener('click', (event) => {
    const choice = event.target instanceof Element ? event.target.closest('[data-region-choice]') : null;
    if (!choice) return;
    event.preventDefault();
    region = choice.getAttribute('data-region-choice') || 'all';
    filter();
    const table = document.getElementById('components-title');
    if (table && choice.closest('.rg-map, .rg-key')) table.scrollIntoView({ block: 'start' });
  });

  let shownAt = document.querySelector('[data-generated-at] time')?.getAttribute('datetime');
  const refresh = async () => {
    try {
      const response = await fetch('/api/public/status', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const status = await response.json();
      if (!status.generatedAt || status.generatedAt === shownAt) return;
      const page = await fetch('/', { headers: { Accept: 'text/html' } });
      if (!page.ok) return;
      const next = new DOMParser().parseFromString(await page.text(), 'text/html');
      // What the stylesheet lays out for one snapshot: the Regions map's positions and the heatmap's dates.
      const laidOut = (doc) => ['data-map', 'data-axis', 'data-lamp-theme'].map((name) => doc.querySelector(`[${name}]`)?.getAttribute(name) || '').join(' ');
      // A new layout, new map positions or new dates come with a new stylesheet: load the page again.
      if (next.body.getAttribute('data-template') !== document.body.getAttribute('data-template') || laidOut(next) !== laidOut(document)) { location.reload(); return; }
      let complete = true;
      for (const part of document.querySelectorAll('[data-live]')) {
        const fresh = next.querySelector(`[data-live="${part.getAttribute('data-live')}"]`);
        if (!fresh) continue;
        // Never pull content out from under the reader's focus; the next poll tries again.
        if (part.contains(document.activeElement) && document.activeElement !== document.body) { complete = false; continue; }
        part.className = fresh.className;
        // A new generation can carry the same public facts. Keep the persistent
        // live region quiet unless its customer-facing content changes.
        if (part.innerHTML !== fresh.innerHTML) part.replaceChildren(...[...fresh.childNodes].map((node) => document.importNode(node, true)));
      }
      if (complete) shownAt = status.generatedAt;
      relative();
      filter();
    } catch {
      // The page keeps the content it has and says when that was generated.
    }
  };

  relative();
  filter();
  setInterval(relative, 30000);
  setInterval(refresh, 30000);
})();
