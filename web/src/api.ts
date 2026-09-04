import type {
  ActionInfo,
  FlashProgress,
  ParamValues,
  Readiness,
  RegisterInfo,
  Status,
} from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  registers: () =>
    json<{ groups: Record<string, string>; registers: RegisterInfo[] }>('/api/registers'),

  status: () => json<Status>('/api/status'),

  /** Which panels a run depends on, and whether each has been applied. */
  readiness: () => json<Readiness>('/api/readiness'),

  actions: () =>
    json<{ sections: Record<string, string>; actions: ActionInfo[] }>('/api/actions'),

  /** Preview the register writes a panel would perform. */
  planAction: (id: string, params: ParamValues) =>
    json<{ writes: { register: string; note?: string; hexWords: string[]; targets: string[] }[] }>(
      `/api/actions/${encodeURIComponent(id)}/plan`,
      { method: 'POST', body: JSON.stringify({ params }) },
    ),

  applyAction: (id: string, params: ParamValues) =>
    json<{
      applied?: { register: string; hexWords: string[]; targets: string[] }[];
      dryRun?: boolean;
      background?: boolean;
      estimatedMs?: number;
    }>(
      `/api/actions/${encodeURIComponent(id)}/apply`,
      { method: 'POST', body: JSON.stringify({ params }) },
    ),

  /** Encode without transmitting — used by the packet inspector. */
  encode: (register: string, params: ParamValues) =>
    json<{ id: string; hexWords: string[]; nw: number; regAddr?: number }>('/api/encode', {
      method: 'POST',
      body: JSON.stringify({ register, params }),
    }),

  send: (register: string, params: ParamValues, host?: string) =>
    json<{ hexWords: string[]; targets: string[]; dryRun: boolean }>('/api/send', {
      method: 'POST',
      body: JSON.stringify({ register, params, host }),
    }),

  /** Clear a fault; the only run-state transition an operator asks for directly. */
  acknowledgeError: () =>
    json<Status['state']>('/api/state/acknowledge', { method: 'POST', body: '{}' }),

  log: (limit = 200) =>
    json<{ at: string; level: string; event: string; detail?: Record<string, unknown> }[]>(
      `/api/log?limit=${limit}`,
    ),

  configs: () => json<{ files: string[] }>('/api/configs'),

  /** Stored values for one panel. */
  settings: (id: string) => json<ParamValues>(`/api/settings/${encodeURIComponent(id)}`),

  /** What this panel last actually sent to the cards. */
  appliedSettings: (id: string) =>
    json<{ params: ParamValues | null; at: string | null }>(
      `/api/settings/${encodeURIComponent(id)}/applied`,
    ),

  /** Per-channel values for a grid panel, keyed "cardIndex:channel". */
  channelSettings: (id: string) =>
    json<Record<string, ParamValues>>(`/api/settings/${encodeURIComponent(id)}/channels`),

  /** Apply an edit to every named channel. */
  setChannelSettings: (id: string, keys: string[], params: ParamValues) =>
    json<{ updated: number }>(`/api/settings/${encodeURIComponent(id)}/channels`, {
      method: 'PUT',
      body: JSON.stringify({ keys, params }),
    }),

  /** Remember edited panel values without sending anything. */
  saveSettings: (id: string, params: ParamValues) =>
    json<{ saved: string }>(`/api/settings/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ params }),
    }),

  /** Write every panel's current values to a named configuration file. */
  saveCurrentConfig: (name: string) =>
    json<{ saved: string; entries: number }>('/api/configs/save-current', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  /** Load a configuration file back into the panels. */
  restoreConfig: (name: string) =>
    json<{ file: string; applied: number; skipped: string[] }>(
      `/api/configs/${encodeURIComponent(name)}/restore`,
      { method: 'POST' },
    ),

  loadConfig: (name: string) =>
    json<{ entries: Record<string, string>; malformed: { line: number; text: string }[] }>(
      `/api/configs/${encodeURIComponent(name)}`,
    ),

  saveConfig: (name: string, entries: Record<string, string>) =>
    json<{ saved: string; count: number }>(`/api/configs/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ entries }),
    }),

  inspectFlash: (text: string) =>
    json<{ recordCount: number; totalBytes: number; blocks: { address: number; length: number }[] }>(
      '/api/flash/inspect',
      { method: 'POST', body: JSON.stringify({ text }) },
    ),

  startFlash: (text: string, host: string, flashSelect: boolean) =>
    json<{ started: boolean }>('/api/flash/start', {
      method: 'POST',
      body: JSON.stringify({ text, host, flashSelect }),
    }),

  cancelFlash: () => json<{ cancelled: boolean }>('/api/flash/cancel', { method: 'POST' }),

  flashProgress: () => json<FlashProgress>('/api/flash/progress'),
};
