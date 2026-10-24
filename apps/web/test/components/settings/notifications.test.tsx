import { afterEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationSettings } from '@/components/settings/notifications.tsx';
import { installDesktop } from '../../support/desktop.ts';
import { findTooltipText } from '../../support/hover.ts';
import { installAudio, installNotifications } from '../../support/notifications.ts';
import { pushSurfaces, startFakeServer, stopFakeServer } from '../../support/server.ts';

let audio: ReturnType<typeof installAudio> | null = null;
let notifications: ReturnType<typeof installNotifications> | null = null;

afterEach(() => {
  audio?.restore();
  audio = null;
  notifications?.restore();
  notifications = null;
});

describe('Settings → Notifications', () => {
  it('shows the three choices on their defaults and plays the sound on Test', () => {
    audio = installAudio();
    render(
      <TooltipProvider>
        <NotificationSettings />
      </TooltipProvider>
    );
    expect(screen.getByText('Play a sound')).toBeDefined();
    expect(screen.getByText('Show a notification')).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Sound' }).textContent).toContain('Chime');
    expect(screen.getByRole('combobox', { name: 'Play a sound' }).textContent).toContain(
      'When Shinsa is in the background'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(audio.played.length).toBeGreaterThan(0);
  });

  it('says what Test does: the sound alone, or with a test notification once the browser allows them', async () => {
    audio = installAudio();
    const view = render(
      <TooltipProvider>
        <NotificationSettings />
      </TooltipProvider>
    );
    expect(await findTooltipText(screen.getByRole('button', { name: 'Test' }))).toBe('Play the sound');
    view.unmount();
    notifications = installNotifications('granted');
    render(
      <TooltipProvider>
        <NotificationSettings />
      </TooltipProvider>
    );
    expect(await findTooltipText(screen.getByRole('button', { name: 'Test' }))).toBe(
      'Play the sound and show a test notification'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() =>
      expect(notifications?.shown.map((shown) => shown.title)).toEqual(['Test notification'])
    );
  });

  it('in a browser tab, says the Shinsa app handles notifications while it is connected, and keeps the rows in the app', async () => {
    startFakeServer();
    try {
      pushSurfaces(true);
      const view = render(
        <TooltipProvider>
          <NotificationSettings />
        </TooltipProvider>
      );
      expect(
        await screen.findByText('The Shinsa app is open and handles notifications, so this page stays quiet.')
      ).toBeDefined();
      expect(screen.queryByRole('combobox', { name: 'Sound' })).toBeNull();
      view.unmount();
      const desktop = installDesktop();
      try {
        render(
          <TooltipProvider>
            <NotificationSettings />
          </TooltipProvider>
        );
        expect(screen.getByRole('combobox', { name: 'Sound' })).toBeDefined();
      } finally {
        desktop.restore();
      }
    } finally {
      pushSurfaces(false);
      stopFakeServer();
    }
  });
});
