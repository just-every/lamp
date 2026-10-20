import assert from "node:assert/strict";
import { join } from "node:path";
import { until } from "./installation-runtime.mjs";

export async function installerEntry(fixture, browser, evidence) {
  // The launcher imports rer; install real locked packages, never symlink them.
  await fixture.run(fixture.rer, ["install"]);
  const process = fixture.launch(globalThis.process.execPath,
    ["scripts/install.mjs", "--no-open", "--no-prefill"]);
  let origin;
  await until(() => {
    assert.ifError(process.error());
    assert.equal(process.child.exitCode, null, "standalone installer remains running");
    origin = /installer: (http:\/\/\S+)/.exec(process.output())?.[1];
    return origin;
  }, "standalone installer starts");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator("#LAMP_PAGE_NAME").waitFor();
  const answers = {
    LAMP_PAGE_NAME: "Release Journey", LAMP_PAGE_TAGLINE: "Service availability",
    SETUP_OPERATOR_EMAIL: "owner@release.example.test", OWNER_DISPLAY_NAME: "Release Owner",
  };
  for (let step = 0; step < 10 && await page.locator("#continue").isVisible(); step++) {
    for (const [key, value] of Object.entries(answers)) {
      const input = page.locator("#" + key);
      if (await input.isVisible()) await input.fill(value);
    }
    await page.locator("#heading").click();
    await page.locator("#continue").click();
    await page.waitForTimeout(200);
  }
  await page.locator("#approve").click();
  await page.waitForFunction(() => {
    const open = document.querySelector("#open");
    return (open && !open.hidden && open.getAttribute("href") && open.dataset.devOpen !== "pending")
      || !document.querySelector("#failed-note")?.hidden;
  }, null, { timeout: 15 * 60000 });
  assert.equal(await page.locator("#open").isVisible(), true,
    "real installer completes build, migrations, owner claim and native runtime startup");
  // Base sets this href through /api/open-app when dev entry is available.
  // Native terminal-issued sign-in confirmation requires a form POST.
  // Keep the installer open and consume its exact entry in a separate app page;
  // never put the private href in output or evidence.
  const href = await page.locator("#open").getAttribute("href");
  assert.ok(href, "completed installer exposes its application entry");
  const appPage = await context.newPage();
  let stage = "open installer entry";
  try {
    const response = await appPage.goto(href);
    assert.equal(response?.ok(), true, `installer entry returns HTTP ${response?.status()}`);
    stage = "finish entry exchange";
    await appPage.waitForURL(url => url.origin !== origin &&
      ["/auth/confirm", "/setup", "/app"].includes(url.pathname));
    if (new URL(appPage.url()).pathname === "/auth/confirm") {
      stage = "submit native confirmation";
      await appPage.getByRole("button", { name: "Confirm", exact: true }).click();
    }
    stage = "reach owner workspace";
    await appPage.waitForURL(url => ["/setup", "/app"].includes(url.pathname));
  } catch (error) {
    const pathname = new URL(appPage.url()).pathname;
    const knownPath = ["/__dev/key", "/auth/dev/enter", "/auth/confirm", "/signin", "/setup", "/app"].includes(pathname);
    const safe = text => text.replace(/https?:\/\/[^\s"'<>]+|(?:token|rer-dev)=[^\s]+|[A-Za-z0-9_-]{32,}/g, "[withheld]");
    console.error("Installer navigation failed: " + JSON.stringify({
      stage, pathname: knownPath ? pathname : "[other path]",
      headings: (await appPage.locator("h1").allTextContents()).map(safe),
      buttons: (await appPage.getByRole("button").allTextContents()).map(safe),
    }));
    const visible = await appPage.locator("body").innerText().catch(() => "");
    if (knownPath && visible && safe(visible) === visible)
      await appPage.screenshot({ path: join(evidence, "installer-entry-failure.png"), fullPage: true });
    throw error;
  }
  return { context, page: appPage, origin: new URL(appPage.url()).origin, expectedOwner: answers.SETUP_OPERATOR_EMAIL };
}

export async function exerciseOwner({ context, page, origin, expectedOwner }, evidence, mode) {
  const session = await page.request.get(origin + "/api/app/session");
  assert.equal(session.status(), 200, "fresh owner entry authenticates");
  const operator = (await session.json()).operator;
  assert.equal(operator.isSetupOperator, true, "fresh entry belongs to the claimed installation owner");
  if (expectedOwner) assert.equal(operator.email, expectedOwner);
  if (new URL(page.url()).pathname === "/setup") {
    await page.getByRole("button", { name: "Skip, I'll fill it in" }).click();
    await page.getByRole("button", { name: "Edit page name" }).click();
    await page.getByLabel("Page name", { exact: true }).fill("Release Journey");
    await page.getByRole("button", { name: "Looks right, open Lamp" }).click();
    await page.waitForURL("**/app");
  }
  // Use the real authenticated API and check both rendered surfaces.
  const created = await page.request.post(origin + "/api/app/components", {
    headers: { Origin: origin },
    data: { name: "Journey service", description: "Fresh local installation", groupId: null,
      internal: false, displayOrder: 0, note: "" },
  });
  assert.equal(created.status(), 201, "new owner can create a component");
  await page.goto(origin + "/app/components");
  await page.getByText("Journey service", { exact: true }).first().waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: join(evidence, `${mode}-components-${width}.png`), fullPage: true });
  }
  const publicPage = await context.newPage();
  const publicOrigin = origin.replace("127.0.0.1", "localhost");
  const response = await publicPage.goto(publicOrigin);
  assert.equal(response.status(), 200);
  await publicPage.getByText("Journey service", { exact: true }).first().waitFor();
  for (const width of [1440, 390]) {
    await publicPage.setViewportSize({ width, height: 1000 });
    await publicPage.screenshot({ path: join(evidence, `${mode}-public-${width}.png`), fullPage: true });
  }
  const signedOut = await page.request.post(origin + "/api/app/session/signout", { headers: { Origin: origin } });
  assert.equal(signedOut.status(), 204);
  assert.equal((await page.request.get(origin + "/api/app/session")).status(), 401);
}
