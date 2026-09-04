import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_TOPOLOGY, TopologyError, validateTopology, type Topology } from '@next-daq/shared';
import { Hooks } from '../src/control/hooks.js';
import { RunLog } from '../src/store/log.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'next-hooks-'));
afterAll(() => fs.rm(tmp, { recursive: true, force: true }));

const hooks = (h: Topology['hooks']) =>
  new Hooks({ ...DEFAULT_TOPOLOGY, hooks: h }, new RunLog(tmp, 'hooks.jsonl'));

/**
 * The "AutoStop DUCK" checkbox ran /home/next/scripts/stopDate.sh when acquisition
 * stopped. The path is configuration here, and only what the configuration file
 * names can run — this console is reachable over HTTP, so nothing from a request
 * may reach a command line.
 */
describe('run-boundary hooks', () => {
  it('does nothing when none is configured', async () => {
    expect(await hooks(undefined).run('onRunStop')).toEqual({ ran: false });
    expect(hooks(undefined).configured('onRunStop')).toBe(false);
  });

  it('runs the configured command', async () => {
    const marker = path.join(tmp, 'ran.txt');
    const r = await hooks({ onRunStop: ['/usr/bin/touch', marker] }).run('onRunStop');
    expect(r).toMatchObject({ ran: true, ok: true });
    await expect(fs.access(marker)).resolves.toBeUndefined();
  });

  it('reports a failing command instead of throwing', async () => {
    // Run control must survive an external script that fails.
    const r = await hooks({ onRunStop: ['/bin/sh', '-c', 'exit 3'] }).run('onRunStop');
    expect(r.ran).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });

  it('reports a command that does not exist', async () => {
    const r = await hooks({ onRunStop: ['/nonexistent/script.sh'] }).run('onRunStop');
    expect(r).toMatchObject({ ran: true, ok: false });
  });

  it('passes arguments without a shell, so they cannot be reinterpreted', async () => {
    // Written literally, not expanded: there is no shell to substitute anything.
    const out = path.join(tmp, 'literal.txt');
    await hooks({ onRunStop: ['/bin/echo', '$HOME; rm -rf /'] }).run('onRunStop');
    const r = await hooks({
      onRunStop: ['/bin/sh', '-c', `printf '%s' "$1" > ${out}`, 'sh', '$HOME; echo pwned'],
    }).run('onRunStop');
    expect(r.ok).toBe(true);
    expect(await fs.readFile(out, 'utf8')).toBe('$HOME; echo pwned');
  });

  it('keeps the start and stop hooks separate', async () => {
    const h = hooks({ onRunStart: ['/usr/bin/true'] });
    expect(h.configured('onRunStart')).toBe(true);
    expect(h.configured('onRunStop')).toBe(false);
    expect(await h.run('onRunStop')).toEqual({ ran: false });
  });

  it('rejects a malformed hook at load rather than at run time', () => {
    for (const bad of [[], [''], 'stopDate.sh' as unknown as string[]]) {
      expect(() =>
        validateTopology({ ...DEFAULT_TOPOLOGY, hooks: { onRunStop: bad } }),
      ).toThrow(TopologyError);
    }
  });

  it('accepts a well-formed hook', () => {
    expect(() =>
      validateTopology({
        ...DEFAULT_TOPOLOGY,
        hooks: { onRunStop: ['/home/next/scripts/stopDate.sh'] },
      }),
    ).not.toThrow();
  });
});
