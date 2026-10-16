// Operator documents arrive server-rendered with their data, and their buttons
// stay disabled until React attaches handlers. Text typed or options chosen
// before then are lost, so a journey waits for the shell's Sign out control.
export function operatorHydrated(page) {
  return page.locator(".header-signout:enabled").waitFor();
}
