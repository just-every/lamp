// Wait for React handlers before editing server-rendered controls.
// Sign out is a native form and works before hydration too.
export async function operatorHydrated(page) {
  try { await page.locator(".operator-shell[data-hydrated]").waitFor({ timeout: 60_000 }); }
  catch (error) {
    // TEMPORARY DIAGNOSTIC (L14): say what the page is doing, then reload once with listeners attached.
    const seen = [];
    page.on("pageerror", e => seen.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on("console", m => { if (m.type() === "error") seen.push(`console: ${m.text().slice(0, 300)}`); });
    page.on("requestfailed", r => seen.push(`requestfailed: ${r.url().slice(0, 160)} ${r.failure()?.errorText}`));
    page.on("response", r => { if (r.status() >= 400) seen.push(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
    const before = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
    await page.reload().catch(() => {});
    await page.locator(".operator-shell[data-hydrated]").waitFor({ timeout: 20_000 }).catch(() => seen.push("still not hydrated after reload"));
    const cookies = (await page.context().cookies().catch(() => [])).map(c => `${c.name.replace(/[A-Za-z0-9]{12,}/g, "…")}:${c.expires > 0 ? Math.round(c.expires - Date.now() / 1000) : c.expires}`);
    const tail = String(globalThis.__lampDiag?.() ?? "").replace(/(rer-dev=|x-rer-dev-key[=:]\s*)[A-Za-z0-9_-]+/g, "$1…").slice(-3500);
    const probe = async path => { try { const r = await globalThis.__lampProbe?.(path); return r ? `${r.status} ${(await r.text()).replace(/\s+/g, " ").slice(0, 500)}` : "no probe"; } catch (e) { return `probe failed: ${e.message}`; } };
    const path = new URL(page.url()).pathname;
    const id = path.split("/").pop();
    const doc = await probe(path);
    const api = await probe(`/api/app/incidents/${id}`);
    const health = await probe("/health?format=json");
    console.log("HYDRATION-DIAG", page.url(), JSON.stringify({ before, seen, cookies, doc, api, health, tail: tail.slice(-1200) }));
    throw error;
  }
}

// Open a screen as a new visit. Settings' panes share one address, and going to the address already shown (its hash
// included) only scrolls, so that visit reloads instead.
export async function openFresh(page, url) {
  if (page.url() === url) await page.reload(); else await page.goto(url);
  await operatorHydrated(page);
}
