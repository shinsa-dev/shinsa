import { Menu, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '../lib/dev-bundle.ts';

interface MenuActions {
  show: () => void;
  open: (path: string) => void;
  step: (offset: -1 | 1) => void;
  reload: () => void;
  restartEngine: () => void;
  update: MenuItemConstructorOptions;
}

export function applyMenu({ show, open, step, reload, restartEngine, update }: MenuActions) {
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `About ${APP_NAME}` },
        update,
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            open('/settings');
            show();
          },
        },
        { label: 'Restart Engine', click: restartEngine },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${APP_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${APP_NAME}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: reload },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => step(-1) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => step(1) },
        { type: 'separator' },
        {
          label: 'Home',
          accelerator: 'Shift+CmdOrCtrl+H',
          click: () => {
            open('/');
            show();
          },
        },
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: APP_NAME, click: show },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
