# Base 14 installer adoption

Lamp adopts Base 14's installer helpers at Base commit
`dbd2d8112cfcc903abc484dcba8f323a4120d5c5`. The copied Base onboarding README
contains the adoption notes for Lamp. The readiness helper and store command
implementation in Lamp's copy remain byte-identical to that Base source.

Base 14 defines startup as elapsed progress while the application is alive, with
owner cancellation, prompt child-exit failure, bounded health probes, and a
configurable hard limit that defaults to 15 minutes. That specific policy
clarifies E.3's phrase “no fixed start deadline”: the old fixed 120-second
cutoff is out; the finite operational hard limit is required. An unlimited wait
is not the acceptance criterion.

Lamp's `scripts/installer/local.mjs` uses Base's captured `store.spawn`, calls
`onApp` with the child, probes the real `/health` endpoint with Base's probe
signal, then awaits `store.waitForReady`. It passes the owner signal and lets
Base apply the 15-minute default. The shared store API accepts a finite
`timeoutMs` override; the Lamp adapter does not expose a separate timeout
setting, which E.3 does not require. On failure Lamp awaits Base's
`store.stopCommands(signal)` cleanup. No Lamp-local readiness timer or helper
is needed.

The earlier blocker conclusion mistook the permitted hard limit for an
acceptance failure. Its one-off probe asserted that an unlimited wait must be
accepted, despite Base 14's explicit finite-hard-limit policy. The probe had no
product or test-suite caller and has been removed instead of being converted
into a permanent test.

This is a source-policy correction, not runtime acceptance evidence. Lamp's
native slow-start, child-failure, cancellation, and end-to-end startup proof
remain for the root acceptance run; this record makes no release-readiness or
hosted-acceptance claim.
