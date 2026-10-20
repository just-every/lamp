// Wait for React handlers before editing server-rendered controls.
// Sign out is a native form and works before hydration too.
export function operatorHydrated(page) {
  return page.locator(".operator-shell[data-hydrated]").waitFor();
}
