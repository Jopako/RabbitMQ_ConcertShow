const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const amqp = require("amqplib");

const PORT = Number(process.env.PORT || 3000);
const AMQP_URL = process.env.AMQP_URL || "amqp://localhost";

const PUBLIC_DIR = path.join(__dirname, "public");

const ARTISTS = [
  { id: "Armandinho", name: "Armandinho" },
  { id: "Cleiton_Rasta", name: "Cleiton Rasta" },
  { id: "Michael_Jackson", name: "Michael Jackson" },
];
const ARTIST_IDS = new Set(ARTISTS.map((a) => a.id));

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req, { maxBytes = 1024 * 1024 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeJoinPublic(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const cleaned = decoded.replaceAll("\\", "/");
  const resolved = path.resolve(PUBLIC_DIR, "." + cleaned);
  if (!resolved.startsWith(PUBLIC_DIR)) return null;
  return resolved;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeJoinPublic(pathname);
  if (!filePath) return false;

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const type = CONTENT_TYPES[ext] || "application/octet-stream";

    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function createRabbitRpc() {
  const connection = await amqp.connect(AMQP_URL);
  const channel = await connection.createChannel();

  await channel.assertQueue("ticket_queue", { durable: true });
  await channel.assertQueue("stock_queue", { durable: true });

  const replyQueue = await channel.assertQueue("", { exclusive: true });
  const pending = new Map();

  await channel.consume(
    replyQueue.queue,
    (msg) => {
      if (!msg) return;
      const correlationId = msg.properties.correlationId;
      const entry = pending.get(correlationId);
      if (!entry) return;

      clearTimeout(entry.timeout);
      pending.delete(correlationId);

      try {
        const parsed = JSON.parse(msg.content.toString("utf8"));
        entry.resolve(parsed);
      } catch (err) {
        entry.reject(err);
      }
    },
    { noAck: true }
  );

  function call(queue, message, { timeoutMs = 3500 } = {}) {
    const correlationId = crypto.randomUUID();
    const payload = Buffer.from(JSON.stringify(message));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(correlationId);
        reject(new Error("RPC_TIMEOUT"));
      }, timeoutMs);

      pending.set(correlationId, { resolve, reject, timeout });

      channel.sendToQueue(queue, payload, {
        persistent: true,
        correlationId,
        replyTo: replyQueue.queue,
      });
    });
  }

  async function close() {
    try {
      await channel.close();
    } finally {
      await connection.close();
    }
  }

  return { call, close };
}

async function main() {
  let rpc;
  try {
    rpc = await createRabbitRpc();
    console.log(`[rabbit] connected: ${AMQP_URL}`);
  } catch (err) {
    console.warn("[rabbit] connection failed (server still starts):", err?.message || err);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/api/artists") {
        if (!rpc) return sendJson(res, 503, { error: "RabbitMQ indisponível (suba o consumer)." });
        const stock = await rpc.call("stock_queue", { type: "stock" });
        const artists = ARTISTS.map((a) => ({
          ...a,
          remaining: Number(stock?.stock?.[a.id] ?? 0),
        }));
        return sendJson(res, 200, { artists });
      }

      if (req.method === "POST" && url.pathname === "/api/buy") {
        if (!rpc) return sendJson(res, 503, { error: "RabbitMQ indisponível (suba o consumer)." });
        const body = await readJson(req);
        const name = String(body?.name || "").trim();
        const artistId = String(body?.artistId || "").trim();

        if (!name) return sendJson(res, 400, { error: "Informe seu nome." });
        if (name.length > 40) return sendJson(res, 400, { error: "Nome muito grande (máx 40)." });
        if (!ARTIST_IDS.has(artistId)) return sendJson(res, 400, { error: "Artista inválido." });

        const result = await rpc.call("ticket_queue", {
          type: "buy",
          userId: name,
          eventId: artistId,
          timestamp: new Date().toISOString(),
        });

        return sendJson(res, 200, result);
      }

      if (req.method === "GET") {
        const ok = await serveStatic(req, res);
        if (ok) return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (err) {
      if (String(err?.message) === "BODY_TOO_LARGE") {
        return sendJson(res, 413, { error: "Payload muito grande." });
      }
      console.error(err);
      sendJson(res, 500, { error: "Erro interno." });
    }
  });

  server.listen(PORT, () => {
    console.log(`[http] http://localhost:${PORT}`);
  });

  process.on("SIGINT", async () => {
    console.log("\n[http] shutting down...");
    try {
      if (rpc) await rpc.close();
    } catch {}
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

