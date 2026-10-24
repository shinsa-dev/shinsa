import type { Settings } from '@shinsa/core';
import { SelectField } from '@/components/controls/select-field.tsx';
import { listAttentionItems, resolveAttentionValue, updateSettings } from '@/lib/settings.ts';
import { SettingRow, SettingsGroup } from './group.tsx';

export function AttentionSettings({ settings }: { settings: Settings }) {
  return (
    <SettingsGroup title='Attention'>
      <SettingRow title='Decisions up now'>
        <SelectField
          label='Decisions up now'
          items={listAttentionItems(settings)}
          value={resolveAttentionValue(settings)}
          onValueChange={(value) => void updateSettings({ attentionLimit: Number(value) })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
