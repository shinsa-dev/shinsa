import { REMOTE_APP_ORIGIN } from '@shinsa/core';
import {
  CHOOSE_CLOUD_SOURCE,
  CLOUD_URL_VARIABLE,
  SOURCE_LABEL,
  type SourceChoice,
  type SourceOption,
  type SourceSetting,
  type SourceSwitch,
} from './schema.ts';

type Env = Readonly<Record<string, string | undefined>>;

export function selectOrigin(value: string | undefined) {
  const url = value ? URL.parse(value) : null;
  return url?.protocol === 'http:' || url?.protocol === 'https:' ? url.origin : null;
}

export function resolveCloudOrigin(env: Env) {
  return selectOrigin(env[CLOUD_URL_VARIABLE]) ?? REMOTE_APP_ORIGIN;
}

function isSameSource(current: SourceSetting, next: SourceSetting) {
  if (current.kind === 'local' || next.kind === 'local') return current.kind === next.kind;
  return current.machine?.id === next.machine?.id && current.machine?.name === next.machine?.name;
}

export function resolveSourceSwitch(current: SourceSetting, next: SourceSetting): SourceSwitch {
  if (isSameSource(current, next)) return 'none';
  return current.kind === next.kind ? 'reload' : 'relaunch';
}

export function resolveSourceChoice(current: SourceSetting, choice: SourceChoice): SourceSetting {
  if (choice === 'local') return { kind: 'local' };
  if (choice === 'choose') return CHOOSE_CLOUD_SOURCE;
  return current;
}

export function listSourceOptions(current: SourceSetting): SourceOption[] {
  const pinned = current.kind === 'cloud' ? current.machine : null;
  return [
    { choice: 'local', label: SOURCE_LABEL.local, checked: current.kind === 'local' },
    ...(pinned ? [{ choice: 'pinned' as const, label: pinned.name, checked: true }] : []),
    { choice: 'choose', label: SOURCE_LABEL.choose, checked: current.kind === 'cloud' && !pinned },
  ];
}

export function describeSource(current: SourceSetting) {
  if (current.kind === 'local') return SOURCE_LABEL.local;
  return current.machine ? `${current.machine.name} on ${SOURCE_LABEL.cloud}` : SOURCE_LABEL.cloud;
}

export function isWelcomeNeeded(launch: { chosen: boolean; packaged: boolean; hasData: boolean }) {
  return !launch.chosen && (!launch.packaged || !launch.hasData);
}
