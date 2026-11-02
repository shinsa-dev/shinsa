import { type Summary, summarize } from './shell-stats.ts';

export interface ConnectSample {
  socketOpen: number;
  handshake: number;
  firstState: number;
  stateFrameBytes: number;
  stateBytes: number;
}

export interface RouteSamples {
  label: string;
  health: number[];
  connects: ConnectSample[];
  requests: Record<string, number[]>;
  parallel: number[];
}

export interface RouteSummary {
  label: string;
  health: Summary;
  socketOpen: Summary;
  handshake: Summary;
  firstState: Summary;
  stateFrameBytes: number;
  stateBytes: number;
  requests: Record<string, Summary>;
  parallel: Summary;
}

export interface CloudSummary {
  first: number;
  warm: Summary;
}

export interface TunnelStart {
  label: string;
  registered: number;
  reachable: number;
}

export interface RemoteReport {
  cloud: CloudSummary | null;
  tunnels: TunnelStart[];
  routes: RouteSummary[];
}

const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export function parseQuickTunnelUrl(line: string) {
  return QUICK_TUNNEL_URL.exec(line)?.[0] ?? null;
}

export function summarizeRoute(samples: RouteSamples): RouteSummary {
  const last = samples.connects.at(-1);
  return {
    label: samples.label,
    health: summarize(samples.health),
    socketOpen: summarize(samples.connects.map((sample) => sample.socketOpen)),
    handshake: summarize(samples.connects.map((sample) => sample.handshake)),
    firstState: summarize(samples.connects.map((sample) => sample.firstState)),
    stateFrameBytes: last?.stateFrameBytes ?? 0,
    stateBytes: last?.stateBytes ?? 0,
    requests: Object.fromEntries(
      Object.entries(samples.requests).map(([path, values]) => [path, summarize(values)])
    ),
    parallel: summarize(samples.parallel),
  };
}

export function summarizeCloud(samples: readonly number[]): CloudSummary | null {
  const [first, ...warm] = samples;
  if (first === undefined) return null;
  return { first, warm: summarize(warm) };
}

function formatMs(value: number) {
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function formatSpread(summary: Summary) {
  return `${formatMs(summary.median)} (p95 ${formatMs(summary.p95)})`;
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function listRouteRows(route: RouteSummary) {
  const rows = [
    ['Plain `GET /health`, no channel', formatSpread(route.health)],
    ['WebSocket open (TCP, TLS, upgrade)', formatSpread(route.socketOpen)],
    ['Handshake, hello to ready', formatSpread(route.handshake)],
    ['Ready to the first state, decoded', formatSpread(route.firstState)],
    ['First state frame on the wire', formatMegabytes(route.stateFrameBytes)],
    ['First state, decoded', formatMegabytes(route.stateBytes)],
    ...Object.entries(route.requests).map(([path, summary]) => [
      `\`GET ${path}\` through the channel`,
      formatSpread(summary),
    ]),
    ['10 parallel `GET /api/health`, all answered', formatSpread(route.parallel)],
  ];
  return rows.map(([leg, value]) => `| ${route.label} | ${leg} | ${value} |`);
}

export function serializeRemoteTable(report: RemoteReport) {
  const rows: string[] = [];
  if (report.cloud) {
    rows.push(`| Shinsa Cloud | Connect call, first (DNS, TLS) | ${formatMs(report.cloud.first)} |`);
    rows.push(`| Shinsa Cloud | Connect call, warm | ${formatSpread(report.cloud.warm)} |`);
  }
  for (const tunnel of report.tunnels) {
    rows.push(`| ${tunnel.label} | cloudflared registered | ${formatMs(tunnel.registered)} |`);
    rows.push(`| ${tunnel.label} | Quick tunnel name resolving (DNS) | ${formatMs(tunnel.reachable)} |`);
  }
  for (const route of report.routes) rows.push(...listRouteRows(route));
  return ['| Path | Leg | Median (p95), or size |', '|---|---|---|', ...rows].join('\n');
}
