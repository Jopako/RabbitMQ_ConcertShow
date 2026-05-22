const amqp = require("amqplib");

const AMQP_URL = process.env.AMQP_URL || "amqp://localhost";

const ticketStock = { Armandinho: 1, Cleiton_Rasta: 1, Michael_Jackson: 1 };

function reply(channel, msg, payload) {
  const replyTo = msg.properties.replyTo;
  const correlationId = msg.properties.correlationId;
  if (!replyTo || !correlationId) return;

  channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(payload)), {
    correlationId,
  });
}

async function processTickets() {
  const connection = await amqp.connect(AMQP_URL);

  const ticketChannel = await connection.createChannel();
  const stockChannel = await connection.createChannel();

  const ticketQueue = "ticket_queue";
  const stockQueue = "stock_queue";

  await ticketChannel.assertQueue(ticketQueue, { durable: true });
  await stockChannel.assertQueue(stockQueue, { durable: true });

  ticketChannel.prefetch(1);

  console.log("[*] Waiting for ticket requests...");

  ticketChannel.consume(ticketQueue, (msg) => {
    if (msg === null) return;

    try {
      const order = JSON.parse(msg.content.toString("utf8"));
      if (order?.type && order.type !== "buy") {
        reply(ticketChannel, msg, { ok: false, reason: "invalid_type" });
        ticketChannel.ack(msg);
        return;
      }

      console.log(`\n[>] Processing order for user: ${order.userId}`);

      const available = ticketStock[order.eventId] ?? 0;

      if (available > 0) {
        ticketStock[order.eventId]--;
        const remaining = ticketStock[order.eventId];
        console.log(`[✓] Ticket sold to ${order.userId}! Remaining: ${remaining}`);
        reply(ticketChannel, msg, { ok: true, remaining, eventId: order.eventId });
      } else {
        console.log(`[✗] Sorry ${order.userId}, tickets are SOLD OUT!`);
        reply(ticketChannel, msg, { ok: false, reason: "sold_out", remaining: 0, eventId: order.eventId });
      }

      ticketChannel.ack(msg);
    } catch (err) {
      console.error("[ticket] failed:", err);
      reply(ticketChannel, msg, { ok: false, reason: "bad_request" });
      ticketChannel.ack(msg);
    }
  });

  console.log("[*] Waiting for stock requests...");

  stockChannel.consume(stockQueue, (msg) => {
    if (msg === null) return;

    try {
      const req = JSON.parse(msg.content.toString("utf8"));
      if (req?.type && req.type !== "stock") {
        reply(stockChannel, msg, { ok: false, reason: "invalid_type" });
        stockChannel.ack(msg);
        return;
      }

      reply(stockChannel, msg, { ok: true, stock: ticketStock });
      stockChannel.ack(msg);
    } catch (err) {
      console.error("[stock] failed:", err);
      reply(stockChannel, msg, { ok: false, reason: "bad_request", stock: ticketStock });
      stockChannel.ack(msg);
    }
  });
}

processTickets().catch(console.error);
