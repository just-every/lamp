import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { browserRuntime, chromium } from './confirmation-browser-runtime.mjs';

const axe = await readFile(new URL('./vendor/axe-core/axe.min.js', import.meta.url), 'utf8');
const pin = JSON.parse(await readFile(new URL('./vendor/axe-core/provenance.json', import.meta.url), 'utf8'));
assert.equal(pin.version, '4.10.3');
assert.equal(pin.files['axe.min.js'].sha256, '880970c081707360e64f34cea25ff91892f5bc95675b0776925b9709dd8a68bb');
assert.equal(createHash('sha256').update(axe).digest('hex'), pin.files['axe.min.js'].sha256);
assert.equal(Buffer.byteLength(axe), pin.files['axe.min.js'].bytes);
const license = await readFile(new URL('./vendor/axe-core/LICENSE', import.meta.url));
assert.equal(createHash('sha256').update(license).digest('hex'), pin.files.LICENSE.sha256);

function contrast(first, second) {
  const luminance = color => {
    const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number)
      .map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function assertPresentation(page, width, label) {
  const metrics = await page.evaluate(() => {
    const heading = document.querySelector('h1');
    const brand = document.querySelector('.brand');
    const mark = document.querySelector('.mark');
    const style = getComputedStyle(heading);
    const markStyle = getComputedStyle(mark);
    return {
      fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight),
      tracking: parseFloat(style.letterSpacing), marginTop: style.marginTop, marginBottom: style.marginBottom,
      aboveGap: heading.getBoundingClientRect().top - brand.getBoundingClientRect().bottom,
      belowGap: heading.nextElementSibling.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
      mark: {
        background: markStyle.backgroundColor, border: markStyle.borderTopColor,
        borderWidths: ['Top', 'Right', 'Bottom', 'Left'].map(side => markStyle[`border${side}Width`]),
        borderStyles: ['Top', 'Right', 'Bottom', 'Left'].map(side => markStyle[`border${side}Style`]),
        width: mark.getBoundingClientRect().width, height: mark.getBoundingClientRect().height,
        opacity: markStyle.opacity, visibility: markStyle.visibility,
      },
      card: getComputedStyle(document.querySelector('main')).backgroundColor,
    };
  });
  assert.equal(metrics.fontSize, width === 390 ? 28 : 30, label);
  assert.ok(Math.abs(metrics.lineHeight / metrics.fontSize - 1.3) < 0.001, `${label}: heading line height`);
  assert.ok(Math.abs(metrics.tracking / metrics.fontSize + 0.02) < 0.00001, `${label}: heading tracking`);
  assert.equal(metrics.marginTop, '0px', label);
  assert.equal(metrics.marginBottom, '24px', label);
  assert.equal(metrics.aboveGap, 32, `${label}: brand-to-heading gap`);
  assert.equal(metrics.belowGap, 24, `${label}: heading-to-copy gap`);
  assert.equal(metrics.mark.width, 32, label);
  assert.equal(metrics.mark.height, 6, label);
  assert.equal(metrics.mark.opacity, '1', label);
  assert.equal(metrics.mark.visibility, 'visible', label);
  assert.deepEqual(metrics.mark.borderWidths, Array(4).fill('1px'), label);
  assert.deepEqual(metrics.mark.borderStyles, Array(4).fill('solid'), label);
  assert.ok(Math.max(contrast(metrics.mark.background, metrics.card), contrast(metrics.mark.border, metrics.card)) >= 3,
    `${label}: visible mark fill or border must contrast with the card at least 3:1`);
}

test('real Chromium confirmation is responsive, focused and accessible across states, schemes and extreme brand accents', async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const accentColor of ['#ffffff', '#000000', '#334155', '#1e293b']) {
      const r = await browserRuntime({ branding: { productName: 'Workspace <A> & '.repeat(5), accentColor, signInPath: '/signin' } });
      try {
        const expired = await r.issue();
        await r.db.prepare('UPDATE oa_tokens SET expires_at=?').bind(Date.now() - 1).run();
        const magic = await r.issue();
        const invite = await r.issue({ invite: true });
        for (const colorScheme of ['light', 'dark']) {
          for (const width of [1440, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme });
            try {
              const page = await context.newPage();
              const violations = [];
              await page.exposeFunction('recordPolicyViolation', value => violations.push(value));
              await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.recordPolicyViolation(event.violatedDirective)));
              for (const [kind, link] of [['magic', magic], ['invite', invite], ['invalid', new URL('/auth/confirm?token=invalid', r.origin)], ['expired', expired]]) {
                const hasPreview = kind === 'magic' || kind === 'invite';
                const response = await page.goto(link.href);
                assert.equal(response.status(), hasPreview ? 200 : 400);
                assert.equal(await page.locator('style').count(), 1);
                assert.equal(await page.locator('[style], script, img, link').count(), 0);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), true);
                assert.equal(await page.locator('main').evaluate(node => getComputedStyle(node).maxWidth), '480px', 'hashed stylesheet actually applies');
                assert.equal(await page.locator('h1').textContent(), hasPreview ? `${kind === 'magic' ? 'Confirm sign-in to' : 'Accept your invitation to'} ${'Workspace <A> & '.repeat(5).trim()}` : 'This link is invalid or expired');
                await assertPresentation(page, width, `${kind}/${width}/${colorScheme}/${accentColor}`);
                await page.keyboard.press('Tab');
                const control = hasPreview ? page.getByRole('button', { name: 'Confirm', exact: true }) : page.getByRole('link', { name: 'Request a new link' });
                assert.equal(await control.evaluate(node => node === document.activeElement), true);
                assert.equal(await control.evaluate(node => getComputedStyle(node).outlineWidth), '3px');
                assert.equal(await control.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
                // Test-only DevTools evaluation runs axe without relaxing the
                // production document CSP or adding any script element.
                await page.evaluate(axe);
                assert.equal(await page.evaluate(() => axe.version), '4.10.3');
                const audit = await page.evaluate(async () => (await axe.run(document)).violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact })));
                assert.deepEqual(audit, [], `${kind}/${width}/${colorScheme}/${accentColor}`);
                assert.deepEqual(violations, []);
              }
            } finally { await context.close(); }
          }
        }
      } finally { await r.close(); }
    }
  } finally { await browser?.close(); }
});

test('Chromium rejects a modified inline stylesheet under the original exact-byte CSP', async () => {
  const r = await browserRuntime();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const link = await r.issue();
    await page.route('**/auth/confirm?*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('</style>', 'body{border-top:19px solid red}</style>') });
    });
    await page.goto(link.href);
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).borderTopWidth), '0px');
    assert.equal(await page.locator('main').evaluate(node => getComputedStyle(node).maxWidth), 'none', 'the entire modified style is rejected');
    assert.equal(await page.locator('button').count(), 1);
  } finally { await browser?.close(); await r.close(); }
});
