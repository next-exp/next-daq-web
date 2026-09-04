import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';

/**
 * Endpoints that take no parameters must accept an empty body.
 *
 * A client that sets `content-type: application/json` on every request — which is
 * the obvious way to write one — sends that header with no body on a parameterless
 * POST. Fastify rejects the combination with FST_ERR_CTP_EMPTY_JSON_BODY, so
 * loading a saved configuration and cancelling a flash both failed with 400.
 */
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-body-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

/** The same parser the server installs. */
async function server() {
  const app = Fastify();
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (body === '' || body === undefined) return done(null, {});
      try {
        done(null, JSON.parse(body));
      } catch {
        // Malformed JSON is the caller's fault, so keep it a 400 rather than
        // letting an unlabelled SyntaxError surface as a server error.
        const err = new Error('Body is not valid JSON') as Error & { statusCode: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );
  app.post<{ Body: { name?: string } }>('/thing', async (req) => ({
    received: req.body ?? null,
    name: req.body?.name ?? null,
  }));
  return app;
}

describe('empty JSON bodies', () => {
  it('accepts the content-type with no body at all', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: {}, name: null });
  });

  it('accepts a request with no content-type', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/thing' });
    expect(res.statusCode).toBe(200);
  });

  it('still parses a real body', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'krypton.txt' }),
    });
    expect(res.json().name).toBe('krypton.txt');
  });

  it('still rejects malformed JSON rather than silently ignoring it', async () => {
    const app = await server();
    const res = await app.inject({
      method: 'POST',
      url: '/thing',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(res.statusCode).toBe(400);
  });
});
