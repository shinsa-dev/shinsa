import { FEEDBACK_REPOSITORY } from '@shinsa/core';
import { Schema } from 'effect';
import { PAGE_ACTIONS } from '../bridge/schema.ts';

export const MenuCommand = Schema.Union([
  Schema.TaggedStruct('Show', {}),
  Schema.TaggedStruct('Open', { path: Schema.String }),
  Schema.TaggedStruct('Step', { offset: Schema.Literals([-1, 1]) }),
  Schema.TaggedStruct('Reload', {}),
  Schema.TaggedStruct('RestartEngine', {}),
  Schema.TaggedStruct('Update', { install: Schema.Boolean }),
  Schema.TaggedStruct('PageAction', { action: Schema.Literals(PAGE_ACTIONS) }),
  Schema.TaggedStruct('OpenExternal', { url: Schema.String }),
  Schema.TaggedStruct('ShowEngineLog', {}),
]);

export type MenuCommand = typeof MenuCommand.Type;

export const HELP_LINKS = {
  website: 'https://shinsa.dev',
  issue: `https://github.com/${FEEDBACK_REPOSITORY}/issues/new`,
} as const;

export type MenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll'
  | 'toggleDevTools'
  | 'close'
  | 'minimize'
  | 'zoom'
  | 'front';

export type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'role'; role: MenuRole; label?: string }
  | {
      kind: 'command';
      label: string;
      command: MenuCommand;
      accelerator?: string;
      enabled?: boolean;
      visible?: boolean;
    };

export interface MenuSection {
  label: string;
  role?: 'window' | 'help';
  entries: MenuEntry[];
}

export interface MenuUpdate {
  label: string;
  enabled: boolean;
  install: boolean;
  visible: boolean;
}
