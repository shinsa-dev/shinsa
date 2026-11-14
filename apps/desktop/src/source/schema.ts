import { REMOTE_TEXT_LIMITS } from '@shinsa/core';
import { Schema } from 'effect';

export const CLOUD_URL_VARIABLE = 'SHINSA_CLOUD_URL';

const MACHINE_ID_LIMIT = 200;

export const PinnedMachine = Schema.Struct({
  id: Schema.NonEmptyString.check(Schema.isMaxLength(MACHINE_ID_LIMIT)),
  name: Schema.NonEmptyString.check(Schema.isMaxLength(REMOTE_TEXT_LIMITS.machineName)),
});

export type PinnedMachine = typeof PinnedMachine.Type;

export const SourceSetting = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({ kind: Schema.Literal('cloud'), machine: Schema.NullOr(PinnedMachine) }),
]);

export type SourceSetting = typeof SourceSetting.Type;

export const LOCAL_SOURCE: SourceSetting = { kind: 'local' };

export const CHOOSE_CLOUD_SOURCE: SourceSetting = { kind: 'cloud', machine: null };

export const SourceChoice = Schema.Literals(['local', 'pinned', 'choose']);

export type SourceChoice = typeof SourceChoice.Type;

export type SourceSwitch = 'none' | 'reload' | 'relaunch';

export interface SourceOption {
  choice: SourceChoice;
  label: string;
  checked: boolean;
}

export const SOURCE_LABEL = {
  menu: 'Engine',
  local: 'This Mac',
  choose: 'Choose a Machine…',
  cloud: 'Shinsa Cloud',
} as const;
