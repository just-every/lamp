import assert from "node:assert/strict";
import { AxeBuilder } from "@axe-core/playwright";

const scriptFreeSessions = new WeakMap();

export async function newScriptFreePage(context) {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  // Chromium tracks this setting per CDP session and ignores an unchanged
  // value. Initialize our session before navigation so its later false command
  // actually enables Axe, rather than being a no-op against Playwright's true.
  await session.send("Emulation.setScriptExecutionDisabled", { value: true });
  scriptFreeSessions.set(page, session);
  return page;
}

// Native navigation and every form interaction happen with scripts disabled.
// Axe itself needs script execution. Audit the same rendered document, then
// disable execution again before the next interaction; never clone its HTML.
export async function analyzeScriptFreePage(page, tags) {
  assert.equal(page.frames().length, 1, "script-free public documents have no unaudited frames");
  const session = scriptFreeSessions.get(page);
  assert.ok(session, "the audit uses the session that disabled scripts before navigation");
  let scriptRequests = 0;
  const observe = request => { if (request.resourceType() === "script") scriptRequests += 1; };
  page.on("request", observe);
  try {
    await session.send("Emulation.setScriptExecutionDisabled", { value: false });
    // Single-document mode keeps result aggregation in this enabled page;
    // Axe's default aggregation page inherits the disabled context setting.
    const results = await new AxeBuilder({ page }).withTags(tags).setLegacyMode().analyze();
    assert.equal(scriptRequests, 0, "the audit must not start application scripts");
    return results;
  } finally {
    await session.send("Emulation.setScriptExecutionDisabled", { value: true });
    page.off("request", observe);
    // Keep this session attached until the page closes. Detaching would reset
    // its emulation setting and re-enable scripts for the next native action.
  }
}

// Browser errors can include credential-bearing URLs, HTML and field values.
// Retain only explicit phases, response statuses and known error class names.
export function accessibilityFailure(cause, surface, diagnostics) {
  const names = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "TimeoutError", "AssertionError", "AbortError"]);
  const errorName = names.has(cause?.name) ? cause.name : "UnknownError";
  const assertion = {};
  for (const field of ["actual", "expected"]) {
    if (["number", "boolean"].includes(typeof cause?.[field])) assertion[field] = cause[field];
  }
  const errorKinds = ["Execution context was destroyed", "Script execution is disabled", "Script Timeout", "arguments are invalid", "axe is not defined", "Cannot read properties of undefined", "window.axe", "not a function", "Content Security Policy", "Target page", "page.evaluate", "frame.evaluate", "locator.evaluate", "Protocol error"].filter(kind => cause?.message?.includes(kind));
  return new Error(`${surface}: ${JSON.stringify({ ...diagnostics, errorName, errorKinds, ...assertion })}; private URL/DOM diagnostics withheld.`);
}

export function observeAuditPage(page, diagnostics) {
  page.on("response", response => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) diagnostics.documentStatus = response.status();
    if (response.status() >= 400) diagnostics.failedResponseTypes = [...new Set([...(diagnostics.failedResponseTypes ?? []), `${request.resourceType()}:${response.status()}`])];
    if (request.resourceType() === "script" && response.status() >= 400) {
      const pathname = new URL(response.url()).pathname;
      const filename = pathname.split("/").at(-1);
      const safeFilename = /^[A-Za-z0-9_.@$-]+\.(?:[cm]?js|tsx?)$/.test(filename ?? "") ? filename : "unclassified-module";
      const prefix = ["/node_modules/", "/@fs/", "/@id/", "/src/", "/.lamp-accessibility-vite-"].find(value => pathname.startsWith(value)) ?? "unclassified-prefix";
      diagnostics.failedScriptModules = [...new Set([...(diagnostics.failedScriptModules ?? []), `${prefix}…/${safeFilename}:${response.status()}`])];
    }
  });
  page.on("pageerror", cause => {
    const names = ["TypeError", "ReferenceError", "SyntaxError", "Error"];
    diagnostics.pageErrorNames = [...new Set([...(diagnostics.pageErrorNames ?? []), names.includes(cause.name) ? cause.name : "UnknownError"])];
  });
}
