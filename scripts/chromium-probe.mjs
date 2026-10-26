import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Use the current bundled headless shell and Playwright's default arguments.
const browser = await chromium.launch({
  headless: true,
  timeout: 30_000,
  args: ['--use-mock-keychain', '--password-store=basic'],
});
try {
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>Chromium launch probe</title>');
  assert.equal(await page.title(), 'Chromium launch probe');
  console.log(`Chromium ${browser.version()} launched successfully`);
} finally {
  await browser.close();
}
