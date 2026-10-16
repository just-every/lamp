import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function until(check, label, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw Error(`Timed out: ${label}`);
}

export async function installation(mode) {
  const source = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), `lamp-release-${mode}-`));
  const home = join(directory, "home");
  await mkdir(home);
  const env = {
    ...Object.fromEntries([
      "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE", "PLAYWRIGHT_BROWSERS_PATH",
    ].filter(key => process.env[key]).map(key => [key, process.env[key]])),
    HOME: home,
    PATH: [join(home, ".local/bin"), join(home, ".local/node/bin"), process.env.PATH].join(delimiter),
    CI: "true",
    RER_SERVER_JOURNEY: "1",
    RER_SERVERS_DIR: join(directory, "servers"),
    RER_JOBS_DIR: join(directory, "jobs"),
    WRANGLER_SEND_METRICS: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    X_LOCAL_EXPLORER: "false",
  };
  const processes = new Map();
  let root, installed = false;
  function launch(command, args, cwd = root ?? directory) {
    const child = spawn("nice", ["-n", "15", command, ...args], {
      cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", error;
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", chunk => { output = (output + chunk).slice(-2 * 1024 * 1024); });
    const ended = new Promise(done => {
      child.once("error", cause => { error = cause; done(); });
      child.once("close", done);
    });
    const process = { child, ended, output: () => output, error: () => error };
    processes.set(child, process);
    return process;
  }
  async function stop(process) {
    const { child } = process;
    if (!child.pid) return;
    // Every process group was created by this fixture; never stop by name.
    try { globalThis.process.kill(-child.pid, "SIGTERM"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    await Promise.race([process.ended, delay(10000)]);
    try { globalThis.process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    await process.ended;
    processes.delete(child);
  }
  async function run(command, args, cwd) {
    const process = launch(command, args, cwd);
    try {
      await until(() => process.error() || process.child.exitCode !== null || process.child.signalCode !== null,
        `${command} ${args[0] ?? ""} exits`, 15 * 60000);
      await process.ended;
      assert.ifError(process.error());
      // Output can hold one-use owner entry links. Keep it in memory only.
      assert.equal(process.child.exitCode, 0, `${command} ${args[0] ?? ""} failed; credential-bearing output withheld`);
      return process.output();
    } finally { await stop(process); }
  }
  async function close() {
    try {
      // Closing the standalone installer also closes the application it owns.
      for (const process of processes.values()) await stop(process);
      if (installed && root) await run(join(home, ".local/bin/rer"), ["dev", "--stop"]);
    } finally {
      for (const process of processes.values()) await stop(process);
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    // The Run page's one line clones the public repository into its repo-name folder; do that clone, then select this candidate.
    const runPage = await readFile(join(source, "src/site/run.ts"), "utf8");
    const line = /clone:\s*'npx -y @runeditrun\/rer dev just-every\/([\w-]+)'/.exec(runPage);
    const folder = /folder:\s*'([\w-]+)'/.exec(runPage);
    assert.ok(line && folder && folder[1] === line[1], "Run page provides the one-line install and its repo-name folder");
    const clone = [null, `https://github.com/just-every/${line[1]}.git`, folder[1]];
    const sha = (await run("git", ["rev-parse", "HEAD"], source)).trim();
    await run("git", ["clone", clone[1], clone[2]]);
    root = join(directory, clone[2]);
    // A pre-push candidate need not exist on the public remote yet. Import
    // exactly its commit object after the real public clone succeeds.
    await run("git", ["fetch", "--no-tags", source, sha]);
    await run("git", ["checkout", "--detach", sha]);
    // Like verify:release, qualify tracked working changes before committing.
    const tracked = (await run("git", ["ls-files", "-z"], source)).split("\0").filter(Boolean);
    for (const path of tracked) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      try { await cp(join(source, path), join(root, path)); }
      catch (error) {
        if (error.code === "ENOENT") await rm(join(root, path), { force: true });
        else throw error;
      }
    }
    const site = await readFile(join(root, "src/base/run-site.ts"), "utf8");
    const installer = /script:\s*'curl -fsSL (https:\/\/[^\s']+) \| sh'/.exec(site);
    assert.ok(installer, "Run page provides its actual public installer");
    const installerPath = join(directory, "install-rer.sh");
    await run("curl", ["-fsSL", installer[1], "-o", installerPath]);
    await run("sh", [installerPath]);
    installed = true;
    const rer = join(home, ".local/bin/rer");
    // Playwright uses bootstrap's real browser, while child tools use empty HOME.
    return { root, env, rer, run, launch, stop, close };
  } catch (error) { await close(); throw error; }
}
