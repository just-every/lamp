// Wait for React handlers before editing server-rendered controls.
// Sign out is a native form and works before hydration too.
export function operatorHydrated(page) {
  return page.locator(".operator-shell[data-hydrated]").waitFor({ timeout: 60_000 });
}

// Open a screen as a new visit. Settings' panes share one address, and going to the address already shown (its hash
// included) only scrolls, so that visit reloads instead.
export async function openFresh(page, url) {
  if (page.url() === url) await page.reload(); else await page.goto(url);
  await operatorHydrated(page);
}
