import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { operatorHydrated } from './operator-hydrated.mjs';

/** Real Settings role writes and reloads using the caller's Owner session. */
export async function operatorRolesBrowserFlow({ page, appUrl, appFetch, actor }) {
  const errors = [];
  const onError = error => errors.push(error.message);
  const onConsole = message => {
    if (message.type() === 'error' && /hydrat|did not match|server rendered/i.test(message.text())) errors.push(message.text());
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  const panel = page.getByRole('region', { name: 'Operators', exact: true });
  const selector = panel.getByRole('combobox', { name: `Role for ${actor.displayName}`, exact: true });
  async function storedActor() {
    const response = await appFetch('/api/app/operators');
    assert.equal(response.status, 200, await response.clone().text());
    const operator = (await response.json()).operators.find(row => row.id === actor.id);
    assert.ok(operator, 'the active operator is listed');
    return operator;
  }
  try {
    assert.equal((await storedActor()).role, 'viewer', 'the journey starts with Viewer access');
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      const role = width === 1440 ? 'responder' : 'communicator';
      const label = width === 1440 ? 'Responder' : 'Communicator';
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${appUrl}/app/settings`);
      await operatorHydrated(page);
      // On a phone the Settings menu is a sheet, opened from the pill above the pane.
      if (width === 390) await page.getByRole('button', { name: 'Settings: Page', exact: true }).click();
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Operators', exact: true }).click();
      await expect(selector).toBeEnabled();
      const savedResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === `/api/app/operators/${actor.id}/role` && response.request().method() === 'POST';
      });
      await selector.selectOption(role);
      const saved = await savedResponse;
      assert.equal(saved.status(), 200, await saved.text());
      const result = await saved.json();
      assert.equal(result.operator.id, actor.id);
      assert.equal(result.operator.role, role);
      await expect(panel.getByRole('status')).toContainText(actor.displayName);
      await expect(panel.getByRole('status')).toContainText(label);
      assert.equal((await storedActor()).role, role, `${width}: the UI saved the selected role`);
      await expect(selector).toBeEnabled();
      await page.reload();
      await operatorHydrated(page);
      await expect(panel).toBeVisible();
      await expect(selector).toHaveValue(role);
      await expect(selector).toBeEnabled();

      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: Settings has no horizontal overflow`);
      const smallText = await panel.evaluate(root => {
        const elements = new Set(root.querySelectorAll('input, select, textarea'));
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (walker.currentNode.textContent.trim()) elements.add(walker.currentNode.parentElement);
        return [...elements].filter(element => element.checkVisibility() && element.getClientRects().length && parseFloat(getComputedStyle(element).fontSize) < 13)
          .map(element => ({ text: (element.textContent || element.getAttribute('aria-label') || element.tagName).trim(), fontSize: getComputedStyle(element).fontSize }));
      });
      assert.deepEqual(smallText, [], `${width}: visible operator text is at least 13px`);
      const controls = panel.locator('button, a, [role="button"]');
      const icons = await controls.evaluateAll(elements => elements.flatMap((element, index) =>
        element.checkVisibility() && !element.innerText.trim() && element.querySelector('svg, img') ? [index] : []));
      for (const index of icons) {
        const control = controls.nth(index), tooltip = page.getByRole('tooltip');
        await control.focus();
        await expect(tooltip).toBeVisible({ timeout: 500 });
        assert.ok((await tooltip.innerText()).trim().length > 0, 'icon focus exposes a short tooltip');
        await control.evaluate(element => element.blur());
        await page.mouse.move(0, 0);
        await expect(tooltip).toBeHidden();
        await control.hover();
        await expect(tooltip).toBeHidden();
        await expect(tooltip).toBeVisible({ timeout: 600 });
        await page.mouse.move(0, 0);
      }
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.filter(row => ['serious', 'critical'].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), [], `${width}: no serious or critical accessibility findings`);
      assert.deepEqual(errors, [], `${width}: no page or hydration errors`);
      if (process.env.LAMP_SCREENSHOTS) await page.screenshot({ path: join(process.env.LAMP_SCREENSHOTS, `${width}-operator-roles.png`), fullPage: true });
    }
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
}
