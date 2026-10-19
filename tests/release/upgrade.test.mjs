import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  cp,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { client, inventory, run, runtime, settle } from "./runtime.mjs";
import { populate } from "./populate.mjs";
import { upgradedJourneys } from "./journeys.mjs";

const root = process.cwd();
const release = JSON.parse(await readFile(join(root, "RELEASE.json"), "utf8"));
const previous = process.env.LAMP_UPGRADE_FROM ?? `v${release.previousVersion}`;
const evidence = process.env.LAMP_UPGRADE_EVIDENCE
  ? resolve(process.env.LAMP_UPGRADE_EVIDENCE)
  : null;
const ownerMigration =
  "CREATE TABLE owner_release_notes(id TEXT PRIMARY KEY,component_id TEXT NOT NULL REFERENCES components(id),note TEXT NOT NULL);";
async function clone(source, target, ref) {
  await run(root, "git", [
    "clone",
    "--quiet",
    "--shared",
    "--no-checkout",
    source,
    target,
  ]);
  await run(target, "git", ["checkout", "--quiet", "--detach", ref]);
}
async function migrate(source, state) {
  await run(source, "pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--persist-to",
    state,
  ]);
  await run(source, process.execPath, [
    "--input-type=module",
    "-e",
    `import {applyOwnerMigrations} from './scripts/owner-migrations.mjs';await applyOwnerMigrations('wrangler.jsonc',['--local','--persist-to',${JSON.stringify(state)}]);`,
  ]);
}
async function archive(source, state, out, action = "export") {
  await run(source, process.execPath, [
    `scripts/${action}.mjs`,
    "--persist-to",
    state,
    action === "export" ? "--out" : "--from",
    out,
  ]);
}
async function snapshot(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

test(
  "released populated Worker upgrades in place, retains owner authority and history, and restores its portable archive",
  { timeout: 1200000 },
  async () => {
    if (evidence) await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(
      join(evidence ?? tmpdir(), ".release-upgrade-"),
    );
    const old = join(directory, "previous"),
      current = join(directory, "current"),
      state = join(directory, "state"),
      restored = join(directory, "restored");
    let mf;
    const mail = [];
    let success = false;
    try {
      const priorSha = (
        await run(root, "git", ["rev-parse", `${previous}^{commit}`])
      ).trim();
      const targetSha = (await run(root, "git", ["rev-parse", "HEAD"])).trim();
      // A shared clone does not inherit a partial clone's promisor remote.
      // Materialize the published tree through the source repository first.
      await run(root, "git", [
        "archive",
        "--format=tar",
        "--output",
        join(directory, "previous-source.tar"),
        priorSha,
      ]);
      await clone(root, old, priorSha);
      assert.equal(
        (await run(old, "git", ["status", "--porcelain"])).trim(),
        "",
        "published checkout contains every release file",
      );
      await clone(root, current, targetSha);
      // Include the actual working candidate (including release metadata edits),
      // while never bringing its private configuration, state or emitted dist.
      const tracked = (await run(root, "git", ["ls-files", "-z"]))
        .split("\0")
        .filter(Boolean);
      for (const path of tracked) {
        try {
          await cp(join(root, path), join(current, path), { recursive: true });
        } catch (error) {
          if (error.code === "ENOENT")
            await rm(join(current, path), { force: true });
          else throw error;
        }
      }
      for (const source of [old, current]) {
        await mkdir(join(source, "migrations/ext"), { recursive: true });
        await writeFile(
          join(source, "migrations/ext/9000_release_owner.sql"),
          ownerMigration,
        );
        await run(
          source,
          "pnpm",
          ["install", "--frozen-lockfile"],
          join(
            directory,
            source === old ? "previous-install.log" : "current-install.log",
          ),
        );
        await run(
          source,
          "pnpm",
          ["run", "build:app"],
          join(
            directory,
            source === old ? "previous-build.log" : "current-build.log",
          ),
        );
      }
      const oldMigrations = (await readdir(join(old, "migrations/core")))
        .filter((p) => p.endsWith(".sql"))
        .sort();
      const newMigrations = (await readdir(join(current, "migrations/core")))
        .filter((p) => p.endsWith(".sql"))
        .sort();
      for (const name of oldMigrations)
        assert.equal(
          await readFile(join(current, "migrations/core", name), "utf8"),
          await readFile(join(old, "migrations/core", name), "utf8"),
          `applied migration ${name} must remain immutable`,
        );
      const added = newMigrations.filter(
        (name) => !oldMigrations.includes(name),
      );
      await migrate(old, state);
      mf = await runtime(old, state, mail);
      const data = await populate(mf, old, mail);
      const db = await mf.getD1Database("DB");
      await db
        .prepare("INSERT INTO owner_release_notes VALUES(?,?,?)")
        .bind(
          "owner-annotation",
          data.component.id,
          "Retain escalation to the owner",
        )
        .run();
      await settle(mf);
      const before = await inventory(mf);
      assert.equal(
        data.owner.isSetupOperator,
        true,
        "fixture claims setup authority",
      );
      assert.equal(
        before.objects[data.logoKey].bytes,
        data.logo,
        "uploaded logo retains its original bytes",
      );
      await snapshot(join(directory, "before-inventory.json"), before);
      for (const name of [
        "component_groups",
        "components",
        "component_state_history",
        "incidents",
        "incident_updates",
        "incident_drafts",
        "incident_reports",
        "maintenance",
        "subscribers",
        "subscriber_tokens",
        "subscriber_components",
        "notification_deliveries",
        "notification_outbox",
        "mail_send_ledger",
        "audit_entries",
        "ik_jobs",
        "channel_destinations",
        "alert_sources",
        "owner_release_notes",
      ])
        assert.ok(
          before.tables[name]?.length,
          `${name} is populated on the released Worker`,
        );
      await mf.dispose();
      mf = undefined;
      await archive(old, state, join(directory, "before-backup"));
      const backed = JSON.parse(
        await readFile(join(directory, "before-backup/entities.json"), "utf8"),
      );
      assert.ok(
        backed.tables.find((t) => t.name === "owner_release_notes")?.rows
          .length,
        "supported backup includes owner sidecar",
      );
      await migrate(current, state);
      mf = await runtime(current, state, mail);
      const migrated = await inventory(mf);
      // A migration may add columns; existing rows keep every original value
      // and carry each added column's declared default (null when it has
      // none), so no migration writes data into existing records.
      const migratedDb = await mf.getD1Database("DB");
      const addedDefault = async (table, column) => {
        const { dflt_value: declared } = await migratedDb
          .prepare("SELECT dflt_value FROM pragma_table_info(?) WHERE name = ?")
          .bind(table, column)
          .first();
        // ADD COLUMN accepts only constant defaults, so SQLite evaluates it alone.
        return declared === null ? null : (await migratedDb.prepare(`SELECT ${declared} AS value`).first()).value;
      };
      for (const [name, rows] of Object.entries(before.tables))
        if (name !== "d1_migrations") {
          const original = new Set(rows.flatMap((row) => Object.keys(row)));
          assert.deepEqual(
            migrated.tables[name]?.map((row) =>
              Object.fromEntries(Object.entries(row).filter(([column]) => original.has(column))),
            ),
            rows,
            `migration preserves existing ${name} records`,
          );
          for (const row of migrated.tables[name] ?? [])
            for (const [column, value] of Object.entries(row))
              if (!original.has(column))
                assert.equal(value, await addedDefault(name, column), `migration leaves added ${name}.${column} at its declared default on existing records`);
        }
      assert.deepEqual(
        migrated.objects,
        before.objects,
        "the deployment keeps original R2 objects before any current runtime publication",
      );
      assert.deepEqual(
        migrated.tables.d1_migrations.map((row) => row.name),
        newMigrations,
        "only unapplied migrations were appended",
      );
      const { c, published } = await upgradedJourneys(
        mf,
        data,
        before,
        current,
        mail,
      );
      await settle(mf);
      const after = await inventory(mf);
      await snapshot(join(directory, "after-inventory.json"), after);
      await mf.dispose();
      mf = undefined;
      const afterArchive = join(directory, "after-backup");
      await archive(current, state, afterArchive);
      await archive(current, restored, afterArchive, "import");
      await archive(current, restored, join(directory, "restored-backup"));
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(directory, "restored-backup/entities.json"),
            "utf8",
          ),
        ),
        JSON.parse(await readFile(join(afterArchive, "entities.json"), "utf8")),
        "supported restore preserves the full entity graph including journal, credentials and owner sidecar",
      );
      mf = await runtime(current, restored, mail);
      const restoredInventory = await inventory(mf);
      for (const [key, value] of Object.entries(after.objects))
        assert.deepEqual(
          restoredInventory.objects[key],
          value,
          `restore retains ${key}`,
        );
      const rc = client(mf, c.cookie);
      assert.deepEqual((await rc.api("/api/app/session")).operator, data.owner);
      assert.equal(
        (await rc.public(`/incidents/${published.reference}`)).status,
        200,
      );
      assert.equal(
        (await rc.api("/api/app/incidents/" + data.resolved.id + "/report"))
          .report.summary,
        "Retained postmortem",
      );
      const targetPatch = await run(root, "git", ["diff", "--binary", "HEAD"]);
      await writeFile(join(directory, "target-source.patch"), targetPatch);
      const receipt = {
        previous,
        priorSha,
        targetSha,
        trackedWorkingChanges: (
          await run(root, "git", ["diff", "--name-only", "HEAD"])
        )
          .trim()
          .split("\n")
          .filter(Boolean),
        ownerMigration,
        addedMigrations: added,
        previousVersion: JSON.parse(
          await readFile(join(old, "RELEASE.json"), "utf8"),
        ).version,
        targetVersion: release.version,
        tableCounts: Object.fromEntries(
          Object.entries(before.tables).map(([name, rows]) => [
            name,
            rows.length,
          ]),
        ),
        r2Objects: Object.keys(before.objects).length,
        provider: "synthetic Resend edge; no account or provider calls",
        result: "passed",
      };
      await snapshot(join(directory, "receipt.json"), receipt);
      console.log(JSON.stringify(receipt));
      await mf.dispose();
      mf = undefined;
      if (evidence)
        for (const item of [
          "receipt.json",
          "previous-source.tar",
          "target-source.patch",
          "before-inventory.json",
          "after-inventory.json",
          "previous-build.log",
          "current-build.log",
          "before-backup",
          "after-backup",
          "restored-backup",
        ])
          await cp(join(directory, item), join(evidence, item), {
            recursive: true,
          });
      success = true;
    } finally {
      await mf?.dispose();
      if (success) await rm(directory, { recursive: true, force: true });
      else console.error(`Failed upgrade evidence retained at ${directory}`);
    }
  },
);
