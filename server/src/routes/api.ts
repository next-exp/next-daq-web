import type { FastifyInstance } from 'fastify';
import {
  ALL_ACTIONS,
  ALL_REGISTERS,
  GROUP_LABELS,
  SECTION_LABELS,
  encode,
  getRegister,
  parseMcs,
} from '@next-daq/shared';
import type { Session } from '../control/session.js';
import { ConfigStore, parseGains, serialiseConfig } from '../store/config.js';

/**
 * HTTP API.
 *
 * Every endpoint that reaches the detector returns the exact words it sent, so an
 * operator can confirm what went on the wire — the original only printed them to
 * stdout.
 */
export async function registerApi(app: FastifyInstance, session: Session): Promise<void> {
  const configs = new ConfigStore(session.topology.paths.dataDir);

  /** The register catalogue, for building the UI. */
  app.get('/api/registers', async () => ({
    groups: GROUP_LABELS,
    registers: ALL_REGISTERS.map((r) => ({
      id: r.id,
      group: r.group,
      title: r.title,
      regAddr: r.regAddr,
      cmdCode: r.cmdCode,
      target: r.target,
      channelRange: r.channelRange,
      notes: r.notes,
      params: r.params,
    })),
  }));

  app.get('/api/status', async () => session.status());

  /**
   * The operator panels: each is a set of parameters in real units that expands
   * into a sequence of register writes.
   */
  app.get('/api/actions', async () => ({
    sections: SECTION_LABELS,
    actions: ALL_ACTIONS.map((a) => ({
      id: a.id,
      section: a.section,
      group: a.group,
      title: a.title,
      description: a.description,
      origin: a.origin,
      params: a.params,
    })),
  }));

  /** Preview the register writes a panel would perform, without sending them. */
  app.post<{ Body: { params?: Record<string, unknown> }; Params: { id: string } }>(
    '/api/actions/:id/plan',
    async (req, reply) => {
      try {
        return session.planAction(req.params.id, (req.body?.params ?? {}) as never);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  /** Apply a panel: send every planned write in order. */
  app.post<{ Body: { params?: Record<string, unknown> }; Params: { id: string } }>(
    '/api/actions/:id/apply',
    async (req, reply) => {
      try {
        return await session.applyAction(req.params.id, (req.body?.params ?? {}) as never);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.get('/api/topology', async () => session.topology);

  /** Encode without sending — the packet inspector. */
  app.post<{ Body: { register: string; params?: Record<string, unknown> } }>(
    '/api/encode',
    async (req, reply) => {
      const { register, params = {} } = req.body ?? {};
      if (!register) return reply.code(400).send({ error: 'register is required' });
      try {
        const def = getRegister(register);
        const out = encode(def, params as never, 1);
        return { id: out.id, hexWords: out.hexWords, nw: out.nw, regAddr: out.regAddr };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  /** Encode and transmit. */
  app.post<{ Body: { register: string; params?: Record<string, unknown>; host?: string } }>(
    '/api/send',
    async (req, reply) => {
      const { register, params = {}, host } = req.body ?? {};
      if (!register) return reply.code(400).send({ error: 'register is required' });
      try {
        return await session.sendRegister(register, params as never, host);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  /** Run-state transitions. */
  app.post<{ Body: { to: string; reason?: string } }>('/api/state', async (req, reply) => {
    const { to, reason = 'Operator request' } = req.body ?? {};
    try {
      return session.control.moveTo(to as never, reason);
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.get('/api/log', async (req) => {
    const limit = Number((req.query as { limit?: string })?.limit ?? 200);
    return session.log.tail(Number.isFinite(limit) ? limit : 200);
  });

  /* --------------------------------------------------------------- settings */

  /** Current values of every panel — what "save configuration" would write. */
  app.get('/api/settings', async () => session.settings.all());

  app.get<{ Params: { id: string } }>('/api/settings/:id', async (req, reply) => {
    try {
      return session.settings.get(req.params.id);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  /** Remember edited panel values without sending anything to the detector. */
  app.put<{ Params: { id: string }; Body: { params?: Record<string, unknown> } }>(
    '/api/settings/:id',
    async (req, reply) => {
      try {
        session.settings.set(req.params.id, (req.body?.params ?? {}) as never);
        await session.settings.saveToDisk();
        return { saved: req.params.id };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  /* ---------------------------------------------------------------- configs */

  /** Write the current panel values to a named configuration file. */
  app.post<{ Body: { name?: string } }>('/api/configs/save-current', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    try {
      const entries = session.settings.toEntries();
      await configs.save(name, entries);
      await session.log.info('configuration_saved', { file: name, entries: entries.size });
      return { saved: name, entries: entries.size };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Load a configuration file back into the panels. */
  app.post<{ Params: { name: string } }>('/api/configs/:name/restore', async (req, reply) => {
    try {
      const parsed = await configs.load(req.params.name);
      const result = session.settings.fromEntries(parsed.entries);
      await session.settings.saveToDisk();
      await session.log.info('configuration_restored', {
        file: req.params.name,
        applied: result.applied,
        skipped: result.skipped.length,
      });
      return { file: req.params.name, ...result, malformed: parsed.malformed };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/configs', async () => ({ files: await configs.list() }));

  app.get<{ Params: { name: string } }>('/api/configs/:name', async (req, reply) => {
    try {
      const parsed = await configs.load(req.params.name);
      return {
        entries: Object.fromEntries(parsed.entries),
        malformed: parsed.malformed,
      };
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.put<{ Params: { name: string }; Body: { entries: Record<string, string> } }>(
    '/api/configs/:name',
    async (req, reply) => {
      try {
        const entries = new Map(Object.entries(req.body?.entries ?? {}));
        await configs.save(req.params.name, entries);
        return { saved: req.params.name, count: entries.size };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Body: { text: string } }>('/api/gains/parse', async (req, reply) => {
    try {
      const rows = parseGains(req.body?.text ?? '');
      return { rows: rows.length, gains: rows.slice(0, 500) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ flash */

  /** Validate an image without touching hardware. */
  app.post<{ Body: { text: string } }>('/api/flash/inspect', async (req, reply) => {
    try {
      const img = parseMcs(req.body?.text ?? '');
      return {
        recordCount: img.recordCount,
        totalBytes: img.totalBytes,
        blocks: img.blocks.map((b) => ({ address: b.address, length: b.data.length })),
      };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: { text: string; host: string; flashSelect?: boolean };
  }>('/api/flash/start', async (req, reply) => {
    const { text, host, flashSelect } = req.body ?? {};
    if (!text || !host) return reply.code(400).send({ error: 'text and host are required' });
    try {
      // Parse before starting so a malformed image fails immediately rather than
      // after the card has already been put into programming mode.
      parseMcs(text);
      session.startFlash(
        { host, port: session.topology.ports.java, flashSelect, maxRetries: session.topology.timing.maxRetries },
        text,
      );
      return { started: true, host };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/flash/cancel', async () => {
    session.cancelFlash();
    return { cancelled: true };
  });

  app.get('/api/flash/progress', async () => session.flashProgress() ?? { phase: 'idle' });
}
