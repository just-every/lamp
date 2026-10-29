# Getting started

Lamp runs on your own computer first, which is the quickest way to try it. Open a terminal (on a Mac, Terminal in Applications → Utilities; on Windows, your WSL2 distribution), copy this line into it and press Enter:

<!-- rer:recipe -->
```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-lamp
```

macOS, Linux or Windows with WSL2. git is required; rer brings Node and pnpm.

Already have Node 22 or later?

```sh
npx -y @runeditrun/rer dev just-every/run-lamp
```
<!-- /rer:recipe -->

The line installs `rer`, the Run Edit Run command, clones Lamp's `main` into a `run-lamp` folder, installs everything and prepares a local owner. When it is ready it prints `RER_READY` with the app's address and `RER_OPEN`, your private one-click owner entry link: open it on the same computer and keep it private. This free copy runs only on your computer: it sends no email, and nobody else can open it.

To start Lamp again later, run the same line from the same folder, or `cd run-lamp && rer dev`. Adding rer to your shell's PATH is optional for future terminals. `rer dev --stop` stops it.

Next: [Run it locally](../RUN-LOCALLY.md) explains the local addresses and backups. [Put Lamp online](https://run-lamp.com/docs/hosting) compares hosting paths, and [Deploy to Cloudflare](deploy.md) walks through Lamp's owner inputs.
