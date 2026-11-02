import { APP_NAME } from '../app/schema.ts';
import type { MenuEntry, MenuRole, MenuSection, MenuUpdate } from './schema.ts';

const separator: MenuEntry = { kind: 'separator' };

function role(name: MenuRole, label?: string): MenuEntry {
  return label === undefined ? { kind: 'role', role: name } : { kind: 'role', role: name, label };
}

export function listMenuSections(update: MenuUpdate): MenuSection[] {
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
        {
          kind: 'command',
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          command: { _tag: 'Open', path: '/settings' },
        },
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
        separator,
        role('resetZoom'),
        role('zoomIn'),
        role('zoomOut'),
        separator,
        role('togglefullscreen'),
        role('toggleDevTools'),
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
        {
          kind: 'command',
          label: 'Home',
          accelerator: 'Shift+CmdOrCtrl+H',
          command: { _tag: 'Open', path: '/' },
        },
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
  ];
}
