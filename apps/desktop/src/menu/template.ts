import { APP_NAME } from '../app/schema.ts';
import { HELP_LINKS, type MenuEntry, type MenuRole, type MenuSection, type MenuUpdate } from './schema.ts';

const separator: MenuEntry = { kind: 'separator' };

function role(name: MenuRole, label?: string): MenuEntry {
  return label === undefined ? { kind: 'role', role: name } : { kind: 'role', role: name, label };
}

function open(label: string, path: string, accelerator?: string): MenuEntry {
  const entry: MenuEntry = { kind: 'command', label, command: { _tag: 'Open', path } };
  return accelerator === undefined ? entry : { ...entry, accelerator };
}

export function listMenuSections(update: MenuUpdate, { devTools }: { devTools: boolean }): MenuSection[] {
  return [
    {
      label: APP_NAME,
      entries: [
        role('about', `About ${APP_NAME}`),
        {
          kind: 'command',
          label: update.label,
          enabled: update.enabled,
          visible: update.visible,
          command: { _tag: 'Update', install: update.install },
        },
        separator,
        open('Settings…', '/settings', 'CmdOrCtrl+,'),
        { kind: 'command', label: 'Restart Engine', command: { _tag: 'RestartEngine' } },
        separator,
        role('services'),
        separator,
        role('hide', `Hide ${APP_NAME}`),
        role('hideOthers'),
        role('unhide'),
        separator,
        role('quit', `Quit ${APP_NAME}`),
      ],
    },
    {
      label: 'File',
      entries: [
        {
          kind: 'command',
          label: 'New Task',
          accelerator: 'CmdOrCtrl+N',
          command: { _tag: 'PageAction', action: 'new-task' },
        },
        {
          kind: 'command',
          label: 'Command Menu…',
          accelerator: 'CmdOrCtrl+K',
          command: { _tag: 'PageAction', action: 'command-menu' },
        },
        separator,
        role('close', 'Close Window'),
      ],
    },
    {
      label: 'Edit',
      entries: [
        role('undo'),
        role('redo'),
        separator,
        role('cut'),
        role('copy'),
        role('paste'),
        role('pasteAndMatchStyle'),
        role('delete'),
        role('selectAll'),
      ],
    },
    {
      label: 'View',
      entries: [
        { kind: 'command', label: 'Reload', accelerator: 'CmdOrCtrl+R', command: { _tag: 'Reload' } },
        ...(devTools ? [separator, role('toggleDevTools')] : []),
      ],
    },
    {
      label: 'Go',
      entries: [
        { kind: 'command', label: 'Back', accelerator: 'CmdOrCtrl+[', command: { _tag: 'Step', offset: -1 } },
        {
          kind: 'command',
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          command: { _tag: 'Step', offset: 1 },
        },
        separator,
        open('Home', '/', 'Shift+CmdOrCtrl+H'),
        open('Tasks', '/tasks'),
        open('Terminal', '/terminal'),
        open('Settings', '/settings'),
      ],
    },
    {
      label: 'Window',
      role: 'window',
      entries: [
        role('minimize'),
        role('zoom'),
        separator,
        { kind: 'command', label: APP_NAME, command: { _tag: 'Show' } },
        separator,
        role('front'),
      ],
    },
    {
      label: 'Help',
      role: 'help',
      entries: [
        { kind: 'command', label: "What's New", command: { _tag: 'PageAction', action: 'whats-new' } },
        separator,
        {
          kind: 'command',
          label: `${APP_NAME} Website`,
          command: { _tag: 'OpenExternal', url: HELP_LINKS.website },
        },
        {
          kind: 'command',
          label: 'Report an Issue…',
          command: { _tag: 'OpenExternal', url: HELP_LINKS.issue },
        },
        separator,
        { kind: 'command', label: 'Show Engine Log', command: { _tag: 'ShowEngineLog' } },
      ],
    },
  ];
}
