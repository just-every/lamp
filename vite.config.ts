import { demoSockets } from './modules/demo/vite.mjs';
import {fileURLToPath} from 'node:url';
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { archiveOutputGuard } from "@runeditrun/rer/archive-output";
import { developmentIngress } from "./scripts/dev-ingress/plugin.mjs";
import { docsSite } from "./src/site/docs/build/plugin.ts";

const persistStatePath = process.env.RER_STATE_DIR ?? process.env.LAMP_WORKERS_STATE_PATH ?? ".wrangler/state";
const cacheDir = process.env.LAMP_VITE_CACHE_DIR ?? "node_modules/.vite";
const wranglerConfigPath = process.env.LAMP_WRANGLER_CONFIG ?? "wrangler.jsonc";
const inspectorPort = process.env.LAMP_DISABLE_INSPECTOR === "true" ? false : undefined;

export default defineConfig(({ command, isPreview }) => {
  const local = command === "serve" && !isPreview;
  return {
    // Parallel Workers previews must never rebuild each other's optimized
    // dependency graph. Test and browser runners set a private directory.
    cacheDir,
    server: {
      fs: {
        strict: true,
        // Cloudflare's Worker module runner fetches these local module URLs
        // before Vite records them as imported safe paths.
        // The landing page imports repository metadata from this one root file.
        allow: ["src", "public", "node_modules", "modules", "scripts/dev-ingress", "node_modules/@runeditrun/rer/modules", "package.json"],
        deny: ["**/.rer/**", "**/.seed/**", "**/exports/**", "**/*.rer"],
      },
    },
    plugins: [
      demoSockets(),
      archiveOutputGuard(),
      // The public /docs pages, cut from docs/site.json and the repository's Markdown at build time (src/site/docs).
      docsSite(),
      command === "serve" && !isPreview ? developmentIngress(Boolean(process.env.RER_DEV_KEY && process.env.RER_DEV_ORIGIN), persistStatePath) : undefined,
      cloudflare({
        viteEnvironment: { name: "ssr" },
        configPath: wranglerConfigPath,
        // This emulator-only bucket is not SNAPSHOTS and never enters an export
        // or emitted Worker config. Preview executes the production artifact.
        config: (config) => {
          // Loopback stand-ins for api.statuspage.io and for Slack and Teams, for local journeys only.
          const standIns = Object.fromEntries(["LAMP_DEV_STATUSPAGE_ORIGIN", "LAMP_DEV_CHANNEL_RECEIVER"].flatMap((name) => command === "serve" && !isPreview && process.env[name]?.startsWith("http://127.0.0.1:") ? [[name, process.env[name]]] : []));
          const localVar = (name: string) => process.env[name] ? { [name]: process.env[name]! } : {};
          const devAuth = local ? { main: fileURLToPath(new URL('./src/server.dev.ts', import.meta.url)), vars: {
            ...config.vars, ...localVar('RER_DEMO'), ...localVar('RER_DEMO_EXPIRES'),
            AUTH_ORIGIN: process.env.RER_DEV_ORIGIN || process.env.AUTH_ORIGIN || process.env.LAMP_LOCAL_ORIGIN || config.vars?.AUTH_ORIGIN || '',
            AUTH_LOCAL: 'true', ...localVar('SESSION_SECRET'), ...localVar('SETUP_OPERATOR_EMAIL'),
            ...localVar('RER_DEV_ORIGIN'), ...localVar('RER_DEV_KEY'), ...localVar('RER_DEV_IDENTITY'),
          } } : {};
          const statuspage = Object.keys(standIns).length ? { ...devAuth, vars: { ...config.vars, ...devAuth.vars, ...standIns } } : devAuth;
          return statuspage;
        },
        inspectorPort: local ? false : inspectorPort,
        // Keep Vite's Miniflare state beside the Wrangler config so `pnpm dev`'s
        // migration command and the Worker use one local D1 database.
        persistState: { path: persistStatePath },
      }),
      tanstackStart({ prerender: { enabled: false } }),
      react(),
      tailwindcss(),
    ],
    build: {
      // Keep React's private operator assets separate from snapshot-owned public
      // page assets at /assets/status-page.*.
      assetsDir: "app-assets",
    },
  };
});
