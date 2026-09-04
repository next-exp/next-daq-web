import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { loadTopology, isDryRun } from './config.js';
import { Session } from './control/session.js';
import { registerApi } from './routes/api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const topology = await loadTopology();
  const dryRun = isDryRun();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const session = new Session(topology, dryRun);

  await app.register(websocket);
  await registerApi(app, session);

  /** Live status and traffic feed for the operator UI. */
  app.get('/ws', { websocket: true }, (socket) => {
    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    send({ type: 'hello', status: session.status() });
    const unsubscribe = session.subscribe(send);
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  // Serve the built UI when it is present. The wildcard route resolves files at
  // request time, so a UI rebuild does not need a server restart.
  const webDist = path.resolve(HERE, '../../web/dist');
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    // Only genuine client-side routes fall back to the app shell. A missing asset
    // must 404 rather than quietly returning HTML, which would otherwise surface as
    // a blank page with no error anywhere.
    if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.url.startsWith('/assets')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  await session.start();

  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port, host });

  app.log.info(
    { dryRun, cards: topology.cards.length, udpPort: topology.ports.java },
    dryRun
      ? 'Started in dry-run mode: commands are encoded and logged but not transmitted'
      : 'Started with the detector link live',
  );

  // Deterministic shutdown: close the UDP socket and flush the log.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      await session.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
