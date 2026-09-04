import { execFile } from 'node:child_process';
import type { Topology } from '@next-daq/shared';
import type { RunLog } from '../store/log.js';

/**
 * External commands run at run boundaries.
 *
 * This is the "AutoStop DUCK" checkbox: with it ticked, stopping acquisition also
 * stopped the DATE run by shelling out to `/home/next/scripts/stopDate.sh`. The
 * original also ran `elog_client.sh start` when a run began.
 *
 * Two differences from the original, both because this one is reachable over HTTP:
 * the command comes only from the configuration file — nothing from a request
 * reaches a command line — and it is run with `execFile`, so there is no shell to
 * interpret quoting or substitution. A deployment that configures no hooks cannot
 * run anything at all.
 */

/** A hook that outlives this is abandoned rather than blocking the run. */
const HOOK_TIMEOUT_MS = 30_000;

export interface HookResult {
  ran: boolean;
  command?: string;
  ok?: boolean;
  message?: string;
}

export class Hooks {
  constructor(
    private readonly topology: Topology,
    private readonly log: RunLog,
  ) {}

  configured(which: 'onRunStart' | 'onRunStop'): boolean {
    return (this.topology.hooks?.[which]?.length ?? 0) > 0;
  }

  /**
   * Run a configured hook. Never throws: a failing external script must not take
   * down the run control that called it, so the outcome is reported and logged.
   */
  async run(which: 'onRunStart' | 'onRunStop'): Promise<HookResult> {
    const cmd = this.topology.hooks?.[which];
    if (!cmd || cmd.length === 0) return { ran: false };

    const [program, ...args] = cmd;
    const command = cmd.join(' ');

    return new Promise<HookResult>((resolve) => {
      execFile(program, args, { timeout: HOOK_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (err) {
          const message = err.message.trim() || stderr.trim();
          void this.log.error('hook_failed', { hook: which, command, message });
          resolve({ ran: true, command, ok: false, message });
        } else {
          void this.log.info('hook_ran', { hook: which, command });
          resolve({ ran: true, command, ok: true, message: stdout.trim() || undefined });
        }
      });
    });
  }
}
