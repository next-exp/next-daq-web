import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOPOLOGY,
  feBoardAddress,
  getRegister,
  validateTopology,
  type Topology,
} from '@next-daq/shared';
import { CardLink } from '../src/net/link.js';

/**
 * SiPM front-end addressing.
 *
 * The ten FE registers use three different destination modes and two ports. An
 * earlier version of this rewrite flattened them all to one plane target, which
 * would have broadcast per-board settings and failed outright for boards that are
 * not in the configured card list.
 */
describe('front-end board addressing', () => {
  const link = new CardLink(DEFAULT_TOPOLOGY);
  const target = (id: string) => {
    const def = getRegister(id);
    return { def, resolve: (o: Record<string, unknown> = {}) =>
      link.resolveTargets(def.target, { port: def.port, ...o }) };
  };

  it('derives a board address as 10.0.(board + 128).1', () => {
    expect(feBoardAddress(DEFAULT_TOPOLOGY, 0)).toBe('10.0.128.1');
    expect(feBoardAddress(DEFAULT_TOPOLOGY, 7)).toBe('10.0.135.1');
    expect(feBoardAddress(DEFAULT_TOPOLOGY, 55)).toBe('10.0.183.1');
  });

  it('sends the LED register to one board on the command port', () => {
    const { resolve } = target('SiPMFEConfReg5');
    expect(resolve({ board: 7 })).toEqual([{ host: '10.0.135.1', port: 6039 }]);
  });

  it('refuses a board number outside the configured range', () => {
    const { resolve } = target('SiPMFEConfReg5');
    expect(() => resolve({ board: 56 })).toThrow(/outside 0\.\.55/);
    expect(() => resolve({ board: -1 })).toThrow(/outside 0\.\.55/);
    expect(() => resolve({})).toThrow(/must name the front-end board/);
  });

  it('broadcasts the registers the original broadcast, on port 6038', () => {
    for (const id of [
      'SiPMFEConfReg2',
      'SiPMFEConfReg3',
      'SiPMFEConfReg4',
      'SiPMFEConfReg6',
      'SiPMFEConfReg7',
      'SiPMFEConfReg10',
    ]) {
      const { resolve } = target(id);
      expect(resolve()).toEqual([{ host: '255.255.255.255', port: 6038 }]);
    }
  });

  it('keeps the two front-end ports distinct', () => {
    // Reg1 and Reg5 used 6039; Reg8 and Reg9 used 6038.
    expect(target('SiPMFEConfReg1').resolve({ host: '10.0.135.1' })[0].port).toBe(6039);
    expect(target('SiPMFEConfReg8').resolve({ host: '10.0.135.1' })[0].port).toBe(6038);
    expect(target('SiPMFEConfReg9').resolve({ host: '10.0.135.1' })[0].port).toBe(6038);
  });

  it('honours a different crate layout from configuration', () => {
    const t: Topology = validateTopology({
      ...DEFAULT_TOPOLOGY,
      feBoards: { template: '192.168.{}.10', offset: 10, maxBoard: 3 },
    });
    expect(feBoardAddress(t, 2)).toBe('192.168.12.10');
    expect(() =>
      new CardLink(t).resolveTargets('feBoard', { board: 4, port: 'feCmd' }),
    ).toThrow(/outside 0\.\.3/);
  });

  it('rejects a template that cannot produce an address', () => {
    expect(() =>
      validateTopology({
        ...DEFAULT_TOPOLOGY,
        feBoards: { template: '10.0.0.1', offset: 0, maxBoard: 1 },
      }),
    ).toThrow(/must contain "\{\}"/);
  });
});
