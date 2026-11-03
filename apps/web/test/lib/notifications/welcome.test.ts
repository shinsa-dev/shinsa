import { afterEach, describe, expect, it } from 'bun:test';
import { WELCOME_NOTICE, showNotificationWelcome } from '@/lib/notifications/welcome.ts';
import { writeNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { installDesktop } from '../../support/desktop.ts';

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function desktop() {
  const installed = installDesktop();
  restores.push(installed.restore);
  return installed;
}

describe('the notification welcome', () => {
  it('shows once in the app, so macOS asks for permission while you look', () => {
    const app = desktop();
    expect(showNotificationWelcome()).toBe(true);
    expect(showNotificationWelcome()).toBe(false);
    expect(app.notices).toEqual([WELCOME_NOTICE]);
  });

  it('never shows in a browser and leaves the app its turn', () => {
    expect(showNotificationWelcome()).toBe(false);
    const app = desktop();
    expect(showNotificationWelcome()).toBe(true);
    expect(app.notices).toHaveLength(1);
  });

  it('waits while Show a notification is Never', () => {
    const app = desktop();
    writeNotificationPreferences({ notify: 'never' });
    expect(showNotificationWelcome()).toBe(false);
    writeNotificationPreferences({ notify: 'unfocused' });
    expect(showNotificationWelcome()).toBe(true);
    expect(app.notices).toEqual([WELCOME_NOTICE]);
  });
});
