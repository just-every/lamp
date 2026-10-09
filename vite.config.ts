import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { developmentIngress } from "./scripts/dev-ingress/plugin.mjs";

const persistStatePath = process.env.LAMP_WORKERS_STATE_PATH ?? "deploy/.wrangler/state";
const cacheDir = process.env.LAMP_VITE_CACHE_DIR ?? "node_modules/.vite";
const wranglerConfigPath = process.env.LAMP_WRANGLER_CONFIG ?? "deploy/wrangler.template.toml";
const inspectorPort = process.env.LAMP_DISABLE_INSPECTOR === "true" ? false : undefined;

export default defineConfig(({ command, isPreview }) => {
  const localOutbox = command === "serve" && !isPreview && process.env.LAMP_DEV_OUTBOX_MODE === "local";
  return {
    // Parallel Workers previews must never rebuild each other's optimized
    // dependency graph. Test and browser runners set a private directory.
    cacheDir,
    plugins: [
      command === "serve" && !isPreview ? developmentIngress(localOutbox, persistStatePath) : undefined,
      cloudflare({
        viteEnvironment: { name: "ssr" },
        configPath: wranglerConfigPath,
        // This emulator-only bucket is not SNAPSHOTS and never enters an export
        // or emitted Worker config. Preview executes the production artifact.
        config: (config) => {
          if (config.r2_buckets?.some((bucket) => bucket.binding === "LAMP_DEV_OUTBOX")) {
            throw new Error("LAMP_DEV_OUTBOX is managed only by local Vite development.");
          }
          return localOutbox
            ? { r2_buckets: [...(config.r2_buckets ?? []), { binding: "LAMP_DEV_OUTBOX", bucket_name: "lamp-local-development-outbox" }] }
            : {};
        },
        inspectorPort: localOutbox ? false : inspectorPort,
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
