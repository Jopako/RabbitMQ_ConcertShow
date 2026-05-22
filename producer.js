const amqp = require("amqplib");

async function buyTicket(userId, eventId) {
  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  const queue = "ticket_queue";

  await channel.assertQueue(queue, { durable: true });

  const order = { userId, eventId, timestamp: new Date().toISOString() };

  channel.sendToQueue(queue, Buffer.from(JSON.stringify(order)), {
    persistent: true,
  });   
  console.log(`[x] Ticket request sent:`, order);

  setTimeout(() => connection.close(), 500);
}


buyTicket('Pedrinho', 'Armandinho');
buyTicket('Ronaldo', 'Cleiton_Rasta');
buyTicket('Thomas', 'Michael_Jackson');
buyTicket('Marcos' , 'Cleiton_Rasta');

