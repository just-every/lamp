#!/usr/bin/env node
// Run with pinned Node: node --experimental-strip-types scripts/sorry-capture.mjs.
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const help = `Capture original Sorry JSON locally, without sending a key to Lamp.

  node --experimental-strip-types scripts/sorry-capture.mjs --page-id PAGE --out /new/private/directory
  node --experimental-strip-types scripts/sorry-capture.mjs --page-id PAGE --key-file /private/token-file --out /new/private/directory
  node --experimental-strip-types scripts/sorry-capture.mjs --public-url https://status.example.com --out /new/private/directory

Authenticated mode asks for a hidden token on a TTY unless --key-file is used.
No token argument or environment variable is accepted. The token file must be a
regular file owned by you, with no group/other permissions. --out must be a new
directory outside this checkout. Public mode accepts an HTTPS origin only and
does not read a key. Capture performs GET requests only; redirects are refused.
Public mode also writes <out>.metadata.json beside the folder, so every file in
the folder can be selected in Move in.
`;

class CaptureError extends Error {}
const fail = (message) => { throw new CaptureError(message); };

function options(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return null;
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--page-id", "--public-url", "--out", "--key-file"].includes(flag)
      || result[flag] !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) {
      fail("Invalid capture options. Use --help; never pass a token as an argument.");
    }
    result[flag] = args[index + 1];
  }
  if (!result["--out"] || Boolean(result["--page-id"]) === Boolean(result["--public-url"])) {
    fail("Choose exactly one of --page-id or --public-url, and supply --out.");
  }
  if (result["--public-url"] && result["--key-file"]) fail("Public capture does not accept a key file.");
  if (result["--page-id"] && !/^[A-Za-z0-9_-]{1,128}$/u.test(result["--page-id"])) fail("Invalid Sorry page ID.");
  if (result["--public-url"]) {
    let url;
    try { url = new URL(result["--public-url"]); } catch { fail("Supply a valid public HTTPS origin."); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      fail("Supply a public HTTPS origin without a path, query, fragment or credentials.");
    }
    result["--public-url"] = url.origin;
  }
  return result;
}

async function destination(path) {
  const target = resolve(path);
  const parent = await realpath(dirname(target)).catch(() => fail("The destination parent directory must already exist."));
  const canonical = resolve(parent, basename(target));
  const checkout = await realpath(fileURLToPath(new URL("..", import.meta.url)));
  const within = relative(checkout, canonical);
  if (within === "" || (within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within))) fail("Save capture data outside this checkout.");
  for (const taken of [canonical, metadataPath(canonical)]) {
    try { await lstat(taken); fail("The destination already exists; choose a new directory."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return canonical;
}

// Public captures record their request metadata beside the folder, never inside
// it, so every file in the folder is one Move in accepts.
const metadataPath = (directory) => `${directory}.metadata.json`;

function validToken(value) {
  const token = value.trim();
  if (!/^[\x21-\x7e]{16,4096}$/u.test(token)) fail("The token must be a single printable value, at least 16 characters long.");
  return token;
}

async function keyFile(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096
      || (process.getuid && stat.uid !== process.getuid())) fail("The key file must be a private regular file owned by you (chmod 600).");
    return validToken(await handle.readFile("utf8"));
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    fail("The private key file could not be read.");
  } finally { await handle?.close(); }
}

async function hiddenToken() {
  const input = process.stdin;
  if (!input.isTTY || !process.stderr.isTTY) fail("Use an interactive TTY for the hidden prompt, or provide --key-file.");
  process.stderr.write("Sorry API token (hidden): ");
  const raw = input.isRaw;
  const token = await new Promise((accept, reject) => {
    let value = "";
    const finish = (error) => {
      input.off("data", read);
      input.off("error", broken);
      input.off("end", ended);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, ended);
      input.setRawMode(Boolean(raw));
      input.pause();
      process.stderr.write("\n");
      if (error) reject(error); else accept(value);
    };
    const broken = () => finish(new CaptureError("The hidden token prompt could not be read."));
    const ended = () => finish(new CaptureError("Token entry cancelled."));
    const read = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003" || character === "\u0004") { ended(); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (/^[\x21-\x7e]$/u.test(character)) value += character;
        if (value.length > 4096) { finish(new CaptureError("Token entry is too long.")); return; }
      }
    };
    input.setRawMode(true);
    input.on("data", read).once("error", broken).once("end", ended);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, ended);
    input.resume();
  });
  return validToken(token);
}

async function persist(path, files, token, metadata) {
  if (!files.length || files.length > 200) fail("Capture returned an invalid number of files.");
  let bytes = 0;
  const names = new Set();
  for (const file of files) {
    if (!/^sorry-[A-Za-z0-9_-]+\.json$/u.test(file.name) || names.has(file.name) || typeof file.text !== "string") {
      fail("Capture returned invalid saved response files.");
    }
    names.add(file.name);
    bytes += Buffer.byteLength(file.text);
    if (bytes > 8 * 1024 * 1024) fail("Capture exceeds the 8 MiB saved-response limit.");
    let normalized;
    try { normalized = JSON.stringify(JSON.parse(file.text)); } catch { fail("Capture returned invalid JSON."); }
    if (token && (file.text.includes(token) || normalized.includes(JSON.stringify(token).slice(1, -1)))) {
      fail("The provider reflected the token; no files were written.");
    }
  }
  await mkdir(path, { mode: 0o700 });
  try {
    for (const file of files) await writeFile(resolve(path, file.name), file.text, { flag: "wx", mode: 0o600 });
    if (metadata) await writeFile(metadataPath(path), JSON.stringify({ ...metadata,
      files: files.map(file => ({ name: file.name, sha256: createHash('sha256').update(file.text).digest('hex'), size: Buffer.byteLength(file.text) })),
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch {
    await rm(path, { recursive: true, force: true }).catch(() => {});
    await rm(metadataPath(path), { force: true }).catch(() => {});
    fail("Capture could not be saved; inspect the destination before trying again.");
  }
}

async function main() {
  const args = options(process.argv.slice(2));
  if (!args) { process.stdout.write(help); return; }
  const out = await destination(args["--out"]);
  let token;
  if (args["--page-id"]) token = args["--key-file"] ? await keyFile(args["--key-file"]) : await hiddenToken();
  const { fetchSorryResponses, fetchSorryPublicResponses } = await import("../src/core/features/statuspage-import/sorry/fetch.ts");
  // One request at a time, comfortably below Sorry's documented 10 requests/s.
  let previous = 0;
  const started = Date.now(), requests = [];
  const fetcher = async (...request) => {
    await delay(Math.max(0, previous + 125 - Date.now()));
    previous = Date.now();
    const url = new URL(request[0]);
    const entry = { method: 'GET', path: url.pathname + url.search };
    requests.push(entry);
    try {
      const response = await fetch(...request);
      entry.status = response.status;
      return response;
    } catch {
      entry.networkError = true;
      throw new Error('Sorry network request failed.');
    }
  };
  let files;
  try {
    files = args["--public-url"]
      ? await fetchSorryPublicResponses({ publicUrl: args["--public-url"], fetcher })
      : await fetchSorryResponses({ pageId: args["--page-id"], apiKey: token, fetcher });
  } catch (error) {
    if (args['--public-url']) process.stderr.write(`Public capture requests=${requests.length} elapsedMs=${Date.now() - started} lastStatus=${requests.at(-1)?.status ?? 'network-error'}\n`);
    throw error;
  }
  await persist(out, files, token, args['--public-url'] ? {
    schemaVersion: 1, mode: 'public', origin: args['--public-url'], capturedAt: new Date(started).toISOString(),
    format: 'sorry-public-v1-saved-responses', requests, elapsedMs: Date.now() - started,
  } : undefined);
  token = undefined;
  process.stdout.write(`Saved ${files.length} unchanged Sorry response files. No import or mail was sent.\n`);
  if (args['--public-url']) process.stdout.write(`Public capture requests=${requests.length} elapsedMs=${Date.now() - started}\n`);
}

main().catch((error) => {
  // Never print provider bodies, credentials, request URLs, stack traces or argv.
  process.stderr.write(`${error instanceof CaptureError ? error.message : "Sorry capture failed. Check API access, connectivity and source limits; no complete capture was saved."}\n`);
  process.exitCode = 1;
});
