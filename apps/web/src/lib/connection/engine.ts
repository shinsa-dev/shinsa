import {
  DEVELOPMENT_VERSION,
  type EngineRestartWhen,
  resolveEngineFit,
  type ShinsaBuild,
} from '@shinsa/core';
import * as React from 'react';
import { refreshHealth, type ServerHealth } from '@/lib/connection/health.ts';
import { requestJson } from '@/lib/connection/http.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { createSignal } from '@/lib/signal.ts';

export type EngineAction = 'update_app';

export interface EngineBannerView {
  text: string;
  actions: EngineAction[];
}

export interface EngineStatus {
  version: string;
  label: string;
  tone: Tone;
}

export interface EngineView {
  banner: EngineBannerView | null;
  status: EngineStatus | null;
  automatic: EngineRestartWhen | null;
  key: string;
}

export const ENGINE_ACTION_LABEL: Record<EngineAction, string> = {
  update_app: 'Update Shinsa',
};

const NOTHING: EngineView = { banner: null, status: null, automatic: null, key: '' };

let failure: string | null = null;
const signal = createSignal();

export function recordEngineFailure(message: string | null) {
  failure = message;
  signal.publish();
}

export function useEngineFailure() {
  return React.useSyncExternalStore(signal.subscribe, () => failure);
}

export function resolveEngineView(
  build: ShinsaBuild | null,
  health: ServerHealth | null,
  failed: string | null
): EngineView {
  if (!build || health?.protocol === undefined) return NOTHING;
  const engine = { version: health.version ?? DEVELOPMENT_VERSION, protocol: health.protocol };
  const fit = resolveEngineFit(build, engine);
  const key = `${engine.version}:${engine.protocol}`;
  if (fit.kind === 'match') return NOTHING;
  if (fit.kind === 'update_app') {
    if (!fit.required) return NOTHING;
    return {
      banner: {
        text: 'This app is older than Shinsa’s engine. Update Shinsa to keep working.',
        actions: ['update_app'],
      },
      status: { version: engine.version, label: 'Newer than this app', tone: 'orange' },
      automatic: null,
      key,
    };
  }
  if (failed) {
    return {
      banner: {
        text: `Restart Shinsa’s engine to finish updating to ${build.version}. ${failed}`,
        actions: [],
      },
      status: { version: engine.version, label: `Restart it to move to ${build.version}`, tone: 'orange' },
      automatic: null,
      key,
    };
  }
  return {
    banner: null,
    status: { version: engine.version, label: `Moving to ${build.version}…`, tone: 'neutral' },
    automatic: 'now',
    key,
  };
}

export async function requestEngineRestart(when: EngineRestartWhen) {
  const result = await requestJson<{ restarting: boolean }>('/api/engine/restart', { when });
  await refreshHealth();
  return result;
}
