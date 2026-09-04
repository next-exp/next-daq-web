import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Overview } from './panels/Overview';
import { Registers } from './panels/Registers';
import { Setup } from './panels/Setup';
import { Config } from './panels/Config';
import { Flash } from './panels/Flash';
import { LogView } from './panels/LogView';
import type { ActionProgress, FlashProgress, Status } from './types';

const TABS = [
  ['overview', 'Overview'],
  ['setup', 'Setup'],
  ['registers', 'Registers'],
  ['config', 'Configuration'],
  ['flash', 'Flash'],
  ['log', 'Log'],
] as const;

type Tab = (typeof TABS)[number][0];

const STATE_CLASS: Record<string, string> = {
  RUNNING: 'ok',
  READY: 'ok',
  ERROR: 'err',
  STOPPING: 'warn',
  CONFIGURING: 'warn',
};

export function App() {
  const [tab, setTab] = useState<Tab>('setup');
  const [status, setStatus] = useState<Status>();
  const [flash, setFlash] = useState<FlashProgress>();
  const [actionProgress, setActionProgress] = useState<ActionProgress>();
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(() => {
    api.status().then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    // Poll as a fallback; the socket provides the live updates.
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    // Guards against a superseded socket's late close event clearing the status of
    // the one that replaced it — which StrictMode's double-mount reliably triggers.
    let live = true;

    ws.onopen = () => live && setConnected(true);
    ws.onclose = () => live && setConnected(false);
    ws.onmessage = (ev) => {
      if (!live) return;
      const msg = JSON.parse(ev.data);
      if (msg.type === 'hello') setStatus(msg.status);
      else if (msg.type === 'flash') setFlash(msg.progress);
      else if (msg.type === 'action') setActionProgress(msg);
      else if (msg.type === 'state' || msg.type === 'rx' || msg.type === 'rejected') refresh();
    };

    return () => {
      live = false;
      ws.close();
    };
  }, [refresh]);

  const state = status?.state.state ?? '—';

  return (
    <div className="app">
      <header className="top">
        <h1>NEXT DAQ Control</h1>
        <span className={`badge ${STATE_CLASS[state] ?? ''}`}>{state}</span>
        <span className={`badge ${connected ? 'ok' : 'err'}`}>
          {connected ? 'live' : 'disconnected'}
        </span>
        {status?.dryRun && <span className="badge warn">dry run</span>}
        {status?.trigger.failed && <span className="badge err">trigger failure</span>}
        <span style={{ flex: 1 }} />
        {status && (
          <span className="badge">
            {status.cards.filter((c) => c.repliesReceived > 0).length}/{status.cards.length} cards
          </span>
        )}
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'overview' && (
          <Overview status={status} progress={actionProgress} onChanged={refresh} />
        )}
        {tab === 'setup' && <Setup status={status} progress={actionProgress} />}
        {tab === 'registers' && <Registers status={status} />}
        {tab === 'config' && <Config />}
        {tab === 'flash' && <Flash status={status} progress={flash} />}
        {tab === 'log' && <LogView />}
      </main>
    </div>
  );
}
