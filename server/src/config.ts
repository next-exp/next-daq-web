import { promises as fs } from 'node:fs';
import { DEFAULT_TOPOLOGY, validateTopology, type Topology } from '@next-daq/shared';

/**
 * Deployment configuration loading.
 *
 * Card addresses, ports, log paths and the slow-control endpoint were compiled
 * into the Java. They come from a JSON file here, chosen with
 * `NEXT_DAQ_CONFIG`, so staging, simulation and the real detector differ only by
 * configuration.
 */
export async function loadTopology(file?: string): Promise<Topology> {
  const path = file ?? process.env.NEXT_DAQ_CONFIG;
  if (!path) return validateTopology(DEFAULT_TOPOLOGY);

  let text: string;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read configuration "${path}": ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Configuration "${path}" is not valid JSON: ${(err as Error).message}`);
  }

  // Merge over the defaults so a config need only state what it changes. The
  // nested groups are merged one level deep too: a plain spread would let
  // `{"ports": {"java": 6010}}` drop every other port and fail validation.
  const partial = (parsed ?? {}) as Partial<Topology>;
  const merged: Topology = {
    ...DEFAULT_TOPOLOGY,
    ...partial,
    ports: { ...DEFAULT_TOPOLOGY.ports, ...(partial.ports ?? {}) },
    feBoards: { ...DEFAULT_TOPOLOGY.feBoards, ...(partial.feBoards ?? {}) },
    counts: { ...DEFAULT_TOPOLOGY.counts, ...(partial.counts ?? {}) },
    paths: { ...DEFAULT_TOPOLOGY.paths, ...(partial.paths ?? {}) },
    timing: { ...DEFAULT_TOPOLOGY.timing, ...(partial.timing ?? {}) },
  };
  return validateTopology(merged);
}

/** Whether the server is allowed to actually transmit to the detector network. */
export const isDryRun = (): boolean => process.env.NEXT_DAQ_DRY_RUN === '1';
