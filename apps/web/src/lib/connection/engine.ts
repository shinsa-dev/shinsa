import {
  DEVELOPMENT_VERSION,
  type EngineRestartWhen,
  resolveEngineFit,
  type ShinsaBuild,
} from '@shinsa/core';
import { refreshHealth, type ServerHealth } from '@/lib/connection/health.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { formatClock } from '@/lib/format/time.ts';

export type EngineAction = 'restart_now' | 'restart_idle' | 'update_app';

export interface EngineBannerView {
  tone: 'info' | 'warning';
  text: string;
  actions: EngineAction[];
}

export interface EngineView {
  banner: EngineBannerView | null;
  automatic: EngineRestartWhen | null;
  key: string;
}

export const ENGINE_ACTION_LABEL: Record<EngineAction, string> = {
  restart_now: 'Restart now',
  restart_idle: 'When agents hand over',
  update_app: 'Update Shinsa',
};

const NOTHING: EngineView = { banner: null, automatic: null, key: '' };

function describeRestarting(version: string) {
  return `Restarting the engine into Shinsa ${version}. Agents pick up where they were.`;
}

function describeMove(working: number, latest: string) {
  if (working === 0) return `The engine moves to it once the working agents hand over${latest}.`;
  if (working === 1)
    return `1 agent is working, and the engine moves to it once that agent hands over${latest}.`;
  return `${working} agents are working, and the engine moves to it once they hand over${latest}.`;
}

function describeWaiting(version: string, health: ServerHealth) {
  const latest = health.restartBy ? `, by ${formatClock(health.restartBy)} at the latest` : '';
  return `Shinsa ${version} is installed. ${describeMove(health.working ?? 0, latest)} New steps wait until then.`;
}

export function resolveEngineView(
  build: ShinsaBuild | null,
  health: ServerHealth | null,
  failure: string | null
): EngineView {
  if (!build || health?.protocol === undefined) return NOTHING;
  const engine = { version: health.version ?? DEVELOPMENT_VERSION, protocol: health.protocol };
  const fit = resolveEngineFit(build, engine);
  const key = `${engine.version}:${engine.protocol}`;
  if (fit.kind === 'match') return NOTHING;
  if (fit.kind === 'update_app') {
    if (!fit.required) return NOTHING;
    const text = 'This app is older than Shinsa’s engine. Update Shinsa to keep working.';
    return { banner: { tone: 'warning', text, actions: ['update_app'] }, automatic: null, key };
  }
  if (failure) {
    const text = `Restart Shinsa’s engine to finish updating to ${build.version}. ${failure}`;
    return { banner: { tone: 'warning', text, actions: [] }, automatic: null, key };
  }
  if (health.restart === 'idle') {
    return {
      banner: { tone: 'info', text: describeWaiting(build.version, health), actions: ['restart_now'] },
      automatic: null,
      key,
    };
  }
  if (!health.busy) {
    return {
      banner: { tone: 'info', text: describeRestarting(build.version), actions: [] },
      automatic: 'now',
      key,
    };
  }
  if (fit.required) {
    const text = `Shinsa ${build.version} needs its engine restarted. Restarting now pauses working agents for a moment, then they carry on.`;
    return {
      banner: { tone: 'warning', text, actions: ['restart_now', 'restart_idle'] },
      automatic: null,
      key,
    };
  }
  return {
    banner: { tone: 'info', text: describeWaiting(build.version, health), actions: ['restart_now'] },
    automatic: 'idle',
    key,
  };
}

export async function requestEngineRestart(when: EngineRestartWhen) {
  const result = await requestJson<{ restarting: boolean }>('/api/engine/restart', { when });
  await refreshHealth();
  return result;
}
