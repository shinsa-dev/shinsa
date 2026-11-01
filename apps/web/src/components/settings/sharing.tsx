import type { Settings } from '@shinsa/core';
import { resolveShareLimit, resolveSharePreset } from '@shinsa/core';
import { SelectField } from '@/components/controls/select-field.tsx';
import { updateSettings } from '@/lib/settings.ts';
import {
  SHARE_LIMIT_ITEMS,
  SHARE_LIMIT_SETTING,
  SHARE_PRESET_ITEMS,
  SHARE_PRESET_SETTING,
  SHARING_SECTION,
  SHARING_SECTION_DESCRIPTION,
} from '@/lib/share/dialog.ts';
import { SettingRow, SettingsGroup } from './group.tsx';

export function SharingSettings({ settings }: { settings: Settings }) {
  return (
    <SettingsGroup title={SHARING_SECTION} description={SHARING_SECTION_DESCRIPTION}>
      <SettingRow title={SHARE_PRESET_SETTING}>
        <SelectField
          label={SHARE_PRESET_SETTING}
          items={SHARE_PRESET_ITEMS}
          value={resolveSharePreset(settings)}
          onValueChange={(sharePreset) => void updateSettings({ sharePreset })}
        />
      </SettingRow>
      <SettingRow title={SHARE_LIMIT_SETTING}>
        <SelectField
          label={SHARE_LIMIT_SETTING}
          items={SHARE_LIMIT_ITEMS}
          value={resolveShareLimit(settings)}
          onValueChange={(shareLimit) => void updateSettings({ shareLimit })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
