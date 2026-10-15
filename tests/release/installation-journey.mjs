import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { reservePort } from "../e2e/worker-startup.mjs";
import { installation, until } from "./installation-runtime.mjs";
import { exerciseOwner, installerEntry } from "./installation-browser.mjs";

const mode = process.env.LAMP_RELEASE_JOURNEY;
assert.ok(["installer", "readme"].includes(mode), "set LAMP_RELEASE_JOURNEY to installer or readme");
const evidence = resolve(process.env.LAMP_RELEASE_EVIDENCE ?? `test-results/release-${mode}`);
await mkdir(evidence, { recursive: true });
const fixture = await installation(mode);
let browser, entry;
try {
  browser = await chromium.launch({ headless: true });
  if (mode === "installer") entry = await installerEntry(fixture, browser, evidence);
  else {
    // README sends a local adopter to RUN-LOCALLY.md. Execute that guide's
    // initial command rather than keeping an independently maintained recipe.
    const readme = await readFile(join(fixture.root, "README.md"), "utf8");
    assert.match(readme, /\]\(RUN-LOCALLY\.md\)/, "README links to the canonical local guide");
    const guide = await readFile(join(fixture.root, "RUN-LOCALLY.md"), "utf8");
    const documented = /```sh\s*\n([^`]+)```/.exec(guide)?.[1].trim();
    assert.equal(documented, "rer dev", "the documented initial journey is one dev command");
    const port = await reservePort({ label: "release README journey" });
    const process = fixture.launch(fixture.rer, [...documented.split(/\s+/).slice(1), "--port", String(port)]);
    let open;
    await until(() => {
      assert.ifError(process.error());
      assert.ok(process.child.exitCode === null || process.child.exitCode === 0,
        "documented rer dev reaches readiness");
      open = /^RER_OPEN (\S+)/m.exec(process.output())?.[1];
      return /^RER_READY /m.test(process.output()) && open;
    }, "README rer dev installs, prepares and starts Lamp", 15 * 60000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(open);
    await page.waitForURL(url => ["/setup", "/app"].includes(url.pathname));
    entry = { context, page, origin: `http://127.0.0.1:${port}` };
  }
  await exerciseOwner(entry, evidence, mode);
  console.log(`Release ${mode} journey passed: public installer, fresh clone, owner entry, component publication and sign-out`);
} catch (error) {
  // Browser transport errors can include the navigated one-use entry URL.
  const message = String(error.message).replace(/https?:\/\/[^\s"'<>]+/g, "[URL withheld]");
  console.error(`Release ${mode} journey failed: ${message}`);
  await writeFile(join(evidence, `${mode}-failure.txt`), message + "\n");
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture.close();
}
