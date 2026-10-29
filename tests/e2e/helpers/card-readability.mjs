import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

// Measure the actual painted ancestors, including nested and expanded cards.
export async function cardReadability(page, { directory, name, dark = false }) {
  await page.evaluate(async () => {
    for (const details of document.querySelectorAll('details')) details.open = true;
    await document.fonts.ready;
  });
  const cards = await page.locator('.status-banner, .component-group, .components-section, .component, .timeline-entry, .timeline-incident, .timeline-maintenance, .maintenance-entry, .resolved-list, .history-item, .empty-state, .hm-frame, .hm-callout, .tl-open, .tl-maint, .tl-resolved, .rg-card, .rg-key-item, .rg-row, .rg-rows, .calm-components, .calm-history, .calm-row, .up-figure, .up-situation, .up-band, .subscribe, .tpl-subscribe, .up-subscribe, .data-card, .live-strip, .update-due-notice, .incident-operator-action').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
    let painted = element;
    while (painted && getComputedStyle(painted).backgroundColor === 'rgba(0, 0, 0, 0)') painted = painted.parentElement;
    return { type: element.className, background: painted ? getComputedStyle(painted).backgroundColor : 'transparent' };
  }));
  assert.ok(cards.length > 0, `${name} renders real cards`);
  if (dark) for (const card of cards) {
    const channels = card.background.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    assert.ok(channels.length === 3 && Math.max(...channels) < 100, `${name} ${card.type} keeps a dark card background: ${card.background}`);
  }
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const violations = results.violations.flatMap(rule => rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })));
  await writeFile(`${directory}/${name}.json`, JSON.stringify({ cards, violations }, null, 2) + '\n');
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  assert.deepEqual(violations, [], `${name} has no Axe colour contrast violations`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits its viewport`);
}
