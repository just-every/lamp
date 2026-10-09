import http from "node:http";
import net from "node:net";

// A real TCP boundary ahead of a real HTTP parser. Control only arms connections
// already idle; their next bytes are closed before reaching the parser. It does
// not inspect routes, request input, or which client issued the request.
const connections = [];
const requests = [];
const peers = new Map();
const streams = new Set();
const sockets = new Set();
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const track = (socket) => {
  sockets.add(socket);
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
};
const backend = http.createServer(async (request, response) => {
  const connection = peers.get(request.socket.remotePort);
  connection.httpRequests += 1;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const receipt = {
    connection: connection.id, url: request.url, method: request.method,
    headers: request.headers, body: Buffer.concat(chunks).toString(),
  };
  requests.push(receipt);
  response.on("finish", () => { connection.idle = true; });
  if (request.url === "/disconnect") {
    request.socket.destroy();
  } else if (request.url === "/stream") {
    response.writeHead(200, { "content-type": "text/plain", "x-native-stream": "yes" });
    response.write("first:");
    streams.add(response);
    response.on("close", () => streams.delete(response));
  } else if (request.url === "/redirect") {
    response.writeHead(302, { location: "/echo", "set-cookie": ["first=one; Path=/", "second=two; HttpOnly"] });
    response.end("redirect body");
  } else if (request.url === "/missing") {
    response.writeHead(404, { "content-type": "text/html", "x-fixture": "native-http" });
    response.end("<h1>Missing</h1>");
  } else {
    response.setHeader("content-type", "application/json");
    response.setHeader("set-cookie", ["first=one; Path=/", "second=two; HttpOnly"]);
    response.end(JSON.stringify(receipt));
  }
});
backend.keepAliveTimeout = 60_000;
backend.on("connection", track);
await listen(backend);
const boundary = net.createServer((client) => {
  track(client);
  client.pause();
  const connection = {
    id: connections.length + 1, idle: false, armed: false, closed: false,
    rawEvents: 0, rawBytes: 0, guardedEvents: 0, httpRequests: 0,
  };
  connections.push(connection);
  const upstream = net.connect(backend.address().port, "127.0.0.1", () => {
    peers.set(upstream.localPort, connection);
    client.resume();
  });
  track(upstream);
  client.on("data", (bytes) => {
    connection.rawEvents += 1;
    connection.rawBytes += bytes.length;
    if (connection.armed) {
      connection.guardedEvents += 1;
      client.destroy();
      upstream.destroy();
      return;
    }
    connection.idle = false;
    upstream.write(bytes);
  });
  upstream.on("data", (bytes) => client.write(bytes));
  upstream.on("end", () => client.end());
  upstream.on("close", () => client.destroy());
  client.on("end", () => upstream.end());
  client.on("close", () => {
    connection.closed = true;
    connection.idle = false;
    upstream.destroy();
  });
});
await listen(boundary);
const control = http.createServer((request, response) => {
  if (request.url === "/arm") {
    for (const connection of connections) {
      if (connection.idle && !connection.closed) connection.armed = true;
    }
  } else if (request.url === "/finish-streams") {
    for (const stream of streams) stream.end("last");
  }
  response.setHeader("connection", "close");
  response.end(JSON.stringify({ connections, requests }));
});
control.on("connection", track);
await listen(control);
process.send({ origin: `http://127.0.0.1:${boundary.address().port}`, control: `http://127.0.0.1:${control.address().port}` });
process.on("message", (message) => {
  if (message !== "stop") return;
  for (const socket of sockets) socket.destroy();
  let pending = 3;
  for (const server of [boundary, backend, control]) {
    server.close(() => {
      if (--pending === 0) process.disconnect();
    });
  }
});
