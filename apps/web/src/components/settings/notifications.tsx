import { Button } from '@shinsa/ui/components/button';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useDesktopConnected } from '@/lib/connection/socket.ts';
import { isPageQuiet } from '@/lib/desktop.ts';
import {
  HANDLED_BY_APP,
  needsTestNotification,
  TEST_BOTH,
  TEST_SOUND,
  testNotifications,
  updateNotifications,
} from '@/lib/notifications/settings.ts';
import { playSound } from '@/lib/notifications/sounds.ts';
import {
  type AlertPreference,
  type NotificationPreferences,
  type SoundId,
  useNotificationPreferences,
} from '@/lib/preferences/notifications.ts';
import { ALERT_ITEMS, SOUND_ITEMS } from '@/lib/settings.ts';
import { SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

export function NotificationGroup({
  preferences,
  quiet = false,
  onChange,
}: {
  preferences: NotificationPreferences;
  quiet?: boolean;
  onChange: (patch: Partial<NotificationPreferences>) => void;
}) {
  if (quiet) {
    return (
      <SettingsGroup title='Notifications'>
        <SettingsEmpty>{HANDLED_BY_APP}</SettingsEmpty>
      </SettingsGroup>
    );
  }
  return (
    <SettingsGroup title='Notifications'>
      <SettingRow title='Play a sound'>
        <SelectField<AlertPreference>
          label='Play a sound'
          items={ALERT_ITEMS}
          value={preferences.sound}
          onValueChange={(sound) => onChange({ sound })}
        />
      </SettingRow>
      <SettingRow title='Sound'>
        <Hint label={needsTestNotification(preferences) ? TEST_BOTH : TEST_SOUND}>
          <Button variant='secondary' icon='IconPlay' onClick={() => void testNotifications(preferences)}>
            Test
          </Button>
        </Hint>
        <SelectField<SoundId>
          label='Sound'
          items={SOUND_ITEMS}
          value={preferences.soundId}
          onValueChange={(soundId) => {
            onChange({ soundId });
            void playSound(soundId);
          }}
        />
      </SettingRow>
      <SettingRow title='Show a notification'>
        <SelectField<AlertPreference>
          label='Show a notification'
          items={ALERT_ITEMS}
          value={preferences.notify}
          onValueChange={(notify) => onChange({ notify })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function NotificationSettings() {
  return (
    <NotificationGroup
      preferences={useNotificationPreferences()}
      quiet={isPageQuiet(useDesktopConnected())}
      onChange={(patch) => void updateNotifications(patch)}
    />
  );
}
