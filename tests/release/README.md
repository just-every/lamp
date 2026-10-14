Release verification is separate from ordinary application verification:

```sh
node tests/release/verify.mjs
node tests/release/verify.mjs --from v1.3.0 --evidence /absolute/evidence/directory
```

The default previous tag comes from `RELEASE.json.previousVersion`. Fetch that
release tag before running (CI must retain Git history and tags). The test builds
isolated previous and current checkouts; it never builds the caller's `dist`.
The current checkout includes tracked working edits. No local installation
configuration, credentials, emitted artifacts or saved state are copied.

One native Worker flow creates populated release state, stops the old runtime,
exports its backup, applies only pending core and owner migrations, then starts
the new emitted Worker against the same D1 and R2 state. It checks the retained
entity graph and blob bytes before exercising sessions, publishing, subscriptions,
import history and a supported full archive restore. Only the outgoing mail
provider is simulated; other network requests fail closed. The application,
Worker runtime, SQL, R2, queues, session/token authority and renderers are real.
Initial deployed page settings and an uncertain provider receipt are explicit
test fixtures; ordinary product records and credentials use application doors.

With `--evidence`, success retains before/after inventories, full before/after
archives, the restored archive, build logs and the source receipt. These contain
synthetic fixture credentials only. Temporary checkouts and runtimes are removed
on success. Failure retains its isolated directory for diagnosis and disposes its
runtimes. Provider delivery, deployed infrastructure and browser interaction are
outside this release upgrade check.
