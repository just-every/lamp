import { once } from "node:events";
import { createServer } from "node:net";
import { appOrigin } from "./helpers/hosts.mjs";

// Keep the public socket bound while workerd allocates its internal RPC ports.
// Probing a released port can send HTTP into one of those Cap'n Proto sockets.
const listener = createServer();
let vite;
try {
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const vars = JSON.parse(process.argv[2]);
  appOrigin(port, { ...vars, ...(vars.RER_DEV_KEY ? { RER_DEV_ORIGIN: origin } : {}) });
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ server: { host: "127.0.0.1", port, strictPort: true } });
  const listening = once(vite.httpServer, "listening");
  // Transfer the live handle without closing or allocating the port again.
  vite.httpServer.listen(listener);
  await listening;
  process.stdout.write(`LAMP_PAGE_DATA_ORIGIN=${origin}\n`);
} catch (cause) {
  console.error(cause);
  if (vite) await vite.close();
  listener.close();
  process.exitCode = 1;
}
