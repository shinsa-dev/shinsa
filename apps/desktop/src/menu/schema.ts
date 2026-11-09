import { Schema } from 'effect';

export const MenuCommand = Schema.Union([
  Schema.TaggedStruct('Show', {}),
  Schema.TaggedStruct('Open', { path: Schema.String }),
  Schema.TaggedStruct('Step', { offset: Schema.Literals([-1, 1]) }),
  Schema.TaggedStruct('Reload', {}),
  Schema.TaggedStruct('RestartEngine', {}),
  Schema.TaggedStruct('Update', { install: Schema.Boolean }),
]);

export type MenuCommand = typeof MenuCommand.Type;

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
  role?: 'window';
  entries: MenuEntry[];
}

export interface MenuUpdate {
  label: string;
  enabled: boolean;
  install: boolean;
  visible: boolean;
}
