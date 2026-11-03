import { connection } from '@/lib/connection/socket.ts';
import { replaceAppTransport } from '@/lib/runtime/app.ts';
import { openDemoSockets } from './sockets.ts';
import { DemoTransport } from './transport.ts';

let installed = false;
let connected = false;

function createUuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as const;
}

function installUuid() {
  if (typeof crypto.randomUUID === 'function') return;
  crypto.randomUUID = createUuid as typeof crypto.randomUUID;
}

function keepPath(navigateHistory: History['pushState']): History['pushState'] {
  return (data, unused, url) => {
    if (url === undefined || url === null) {
      navigateHistory(data, unused);
      return;
    }
    const target = new URL(String(url), location.href);
    navigateHistory(data, unused, `${location.pathname}${target.search}${target.hash}`);
  };
}

function installHistoryGuard() {
  history.pushState = keepPath(history.pushState.bind(history));
  history.replaceState = keepPath(history.replaceState.bind(history));
}

export function installDemoConnection() {
  if (connected) return;
  connected = true;
  replaceAppTransport(DemoTransport);
  connection.start();
  openDemoSockets();
  connection.flush();
}

export function installDemoServer() {
  if (installed) return;
  installed = true;
  installUuid();
  installHistoryGuard();
  installDemoConnection();
}
