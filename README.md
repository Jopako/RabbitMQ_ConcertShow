<div align="center">
  <h1>Venda de ingressos com RabbitMQ</h1>
<img width="180" height="140" alt="png-clipart-rabbitmq-advanced-message-queuing-protocol-message-queue-computer-network-others-miscellaneous-computer-network-removebg-preview" src="https://github.com/user-attachments/assets/b4379407-4cef-4f03-8956-eebce41fb614" />

</div>

Projeto demo de compra de ingressos usando **RabbitMQ** como fila e também como **RPC (request/reply)** para o site conseguir responder na hora se a compra foi aprovada ou se está **fora de estoque**.

## Pré‑requisitos

- Node.js 18+ (recomendado Node 20)
- RabbitMQ rodando localmente em `amqp://localhost:5672`

Opcional: subir RabbitMQ via Docker:

```bash
docker run --rm -it \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management
```

- Painel (management): `http://localhost:15672` (user/senha padrão: `guest` / `guest`)

## Como rodar

Instalar dependências:

```bash
npm i
```

Terminal 1 (consumer/worker):

```bash
npm run consumer
```

Terminal 2 (site + API):

```bash
npm start
```

Abrir no navegador:

- `http://localhost:3000`

## Como funciona (visão geral)

Componentes:

- `server.js`: servidor HTTP que serve `public/` e expõe a API.
- `consumer.js`: worker que mantém o estoque em memória e processa pedidos.
- `public/`: front-end (HTML/CSS/JS) que chama a API.
- `producer.js`: exemplo simples de “producer” (não é necessário pro site).

O “estoque” inicial fica no `consumer.js`:

- `Armandinho`: 1
- `Cleiton_Rasta`: 1
- `Michael_Jackson`: 1

## RabbitMQ nessa situação (fila + RPC)

Este projeto usa **duas filas**:

- `ticket_queue`: pedidos de compra
- `stock_queue`: pedidos para consultar o estoque

E usa o padrão **RPC (Request/Reply)** do RabbitMQ:

1. O `server.js` cria uma **fila de resposta exclusiva** (auto-gerada) para receber respostas do worker.
2. Ao enviar uma mensagem, o `server.js` coloca nas propriedades:
   - `replyTo`: nome da fila exclusiva de resposta
   - `correlationId`: id único para casar resposta ↔ requisição
3. O `consumer.js` consome as filas (`ticket_queue` e `stock_queue`), processa e **responde** publicando na fila `replyTo` com o mesmo `correlationId`.
4. O `server.js` espera a resposta (com timeout) e devolve o JSON pro navegador.

### Compra (`ticket_queue`)

Front-end → `POST /api/buy` → `server.js` publica em `ticket_queue`:

```json
{ "type": "buy", "userId": "SeuNome", "eventId": "Armandinho", "timestamp": "..." }
```

O `consumer.js`:

- verifica o estoque em `ticketStock[eventId]`
- se tiver `> 0`, decrementa e responde `{ ok: true, remaining: N }`
- se não tiver, responde `{ ok: false, reason: "sold_out" }`

O site mostra “compra aprovada” ou “fora de estoque”.

### Estoque (`stock_queue`)

Front-end → `GET /api/artists` → `server.js` publica em `stock_queue`:

```json
{ "type": "stock" }
```

O `consumer.js` responde com:

```json
{ "ok": true, "stock": { "Armandinho": 1, "Cleiton_Rasta": 0, "Michael_Jackson": 1 } }
```


- `POST /api/buy` `{ name, artistId }` → retorna `{ ok: true/false, ... }`

