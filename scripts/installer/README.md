# Lamp local setup

`node scripts/install.mjs` needs only Node26.8.1 to open the loopback browser
journey; application dependencies install only after the owner's explicit Start.
Use `--resume` to review saved nonsecret answers. The maintained browser layout
and private session implementation are copied unchanged from Base
`390328736c8dae82f87c86e5af4c17cca6bb9c00`, `onboarding/` (MIT).
`scripts/base-onboarding/` is selected edition-local source; no Base checkout is
needed. This adapter and its validation belong to Lamp.

Local mode installs the pinned pnpm and frozen dependencies, builds without
installer secrets, migrates isolated `.seed/installer/runtime/state`, starts the
real emitted Worker, and initializes the owner through native `/setup`. The
local operator/public host may coincide; hosted installations must use distinct
hosts. Mail credentials and generated token secrets are private mode0600 files
inside mode0700 directories, excluded from Git. The installer terminal owns the
Worker lifecycle. Closing it stops the local Worker; running setup again retains
state and never replaces an owner. Keep the private runtime directory for local
sessions, tokens, records and resume. Mail uses the actual selected provider;
there is no test sender in application code.

Independent mode takes the operator address and bootstrap secret from the
owner's approved independent RER deployment. It calls native setup only after
Start, refuses redirects and checks health, then opens ordinary email sign-in.
It does not provision Cloudflare or transmit provider credentials to a broker.
Choose and configure the mail provider/sender in the approved deployment before
this step; conflicting choices are refused. A setup response never grants a
session. An already initialized application is opened for native sign-in without
changing its owner, page, secrets or data.

The trusted CI descriptor's `operations.setup` is a separate credential-free
Ubuntu toolchain installation; it is not this interactive setup.
