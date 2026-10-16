import { createServer } from "node:net";
import { once } from "node:events";
import { appOrigin } from "./helpers/hosts.mjs";

// Keep the kernel-assigned socket bound throughout Vite/workerd startup. Vite's
// own port: 0 implementation probes and releases a port before binding it again.
const listener = createServer();
const requestedPort = Number(process.argv[2]);
let vite;
try {
  listener.listen(requestedPort, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  const origin = appOrigin(port);
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ server: { host: "127.0.0.1", port, strictPort: true } });
  const listening = once(vite.httpServer, "listening");
  // Node hands the live listening handle to the HTTP server; there is no close
  // or second port allocation. Vite still initializes its environments on listen.
  vite.httpServer.listen(listener);
  await listening;
  process.stdout.write(`LAMP_TEST_ORIGIN=${origin}\n`);
} catch (error) {
  console.error(error.code === "EADDRINUSE" ? `Error: Port ${requestedPort} is already in use` : error);
  if (vite) await vite.close();
  else listener.close();
  process.exitCode = 1;
}
