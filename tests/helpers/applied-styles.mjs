import assert from "node:assert/strict";

export async function assertAppliedStyles(page) {
  const result = await page.evaluate(() => {
    // A failed link is absent from document.styleSheets. Start with the document's
    // applicable declarations so another working sheet cannot hide that failure.
    const links = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].filter(link =>
      !link.disabled && (!link.media || matchMedia(link.media).matches) &&
      (!link.relList.contains("alternate") || (link.sheet && !link.sheet.disabled)));
    const resources = links.map(link => {
      let usable = false;
      try { usable = Boolean(link.sheet && !link.sheet.disabled && link.sheet.cssRules.length > 0); } catch { /* An unreadable sheet cannot prove usable rules. */ }
      return { url: link.href, usable };
    });
    const sheets = links.map(link => link.sheet).filter(Boolean);
    const original = sheets.map(sheet => sheet.disabled);
    const elements = [...document.querySelectorAll("main, main h1, main p, main input, main button")].filter(element => element.getClientRects().length > 0);
    const properties = ["display", "fontFamily", "fontSize", "lineHeight", "padding", "margin", "color", "backgroundColor", "borderStyle", "maxWidth"];
    const appearance = () => elements.map(element => { const style = getComputedStyle(element); return properties.map(property => style[property]).join("|"); });
    const styled = appearance();
    try {
      for (const sheet of sheets) sheet.disabled = true;
      const unstyled = appearance();
      return { resources, applied: styled.some((value, index) => value !== unstyled[index]) };
    } finally { sheets.forEach((sheet, index) => { sheet.disabled = original[index]; }); }
  });
  assert.ok(result.resources.length > 0, "document declares applicable stylesheet resources");
  for (const resource of result.resources) {
    assert.ok(resource.usable, "each applicable stylesheet is currently loaded with usable rules");
    let loaded = false;
    try { loaded = (await page.request.get(resource.url)).ok(); } catch { /* Keep resource URLs out of diagnostics. */ }
    assert.ok(loaded, "each discovered stylesheet resource loads successfully");
  }
  assert.ok(result.applied, "loaded styles change visible public content or controls");
}
