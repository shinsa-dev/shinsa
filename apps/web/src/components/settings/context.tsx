import { listAgentProviders, resolveCompaction, resolveIdleCompaction, type Settings } from '@shinsa/core';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  COMPACTION_MODE_ITEMS,
  listCompactionItems,
  parseCompaction,
  resolveCompactionValue,
  updateSettings,
} from '@/lib/settings.ts';
import { SettingRow, SettingsGroup } from './group.tsx';

export function ContextSettings({ settings }: { settings: Settings }) {
  return (
    <SettingsGroup title='Context'>
      <SettingRow title='Compaction'>
        <SelectField
          label='Compaction'
          items={COMPACTION_MODE_ITEMS}
          value={resolveCompaction(settings)}
          onValueChange={(compaction) => void updateSettings({ compaction })}
        />
      </SettingRow>
      {resolveIdleCompaction(settings, listAgentProviders(settings)).available && (
        <SettingRow title='Compact idle sessions'>
          <SelectField
            label='Compact idle sessions'
            items={listCompactionItems(settings)}
            value={resolveCompactionValue(settings)}
            onValueChange={(value) => void updateSettings(parseCompaction(value))}
          />
        </SettingRow>
      )}
    </SettingsGroup>
  );
}
