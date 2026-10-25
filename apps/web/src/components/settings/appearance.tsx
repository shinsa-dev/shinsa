import { Choice } from '@/components/controls/choice.tsx';
import {
  EXPLORER_SIDE_TITLE,
  EXPLORER_SIDES,
  type ExplorerSide,
  useExplorerSide,
  writeExplorerSide,
} from '@/lib/preferences/code.ts';
import {
  LAYOUT_NAMES,
  LAYOUT_ORDER,
  type LayoutPreference,
  useLayoutPreference,
  writeLayoutPreference,
} from '@/lib/preferences/layout.ts';
import {
  THEME_ITEMS,
  type ThemePreference,
  useThemePreference,
  writeThemePreference,
} from '@/lib/preferences/theme.ts';
import { SettingRow, SettingsGroup } from './group.tsx';

export function AppearanceSettings() {
  const theme = useThemePreference();
  return (
    <SettingsGroup title='Appearance'>
      <SettingRow title='Theme'>
        <Choice<ThemePreference>
          label='Theme'
          items={THEME_ITEMS}
          value={theme}
          onValueChange={writeThemePreference}
        />
      </SettingRow>
      <LayoutSetting />
      <ExplorerSideSetting />
    </SettingsGroup>
  );
}

function ExplorerSideSetting() {
  const side = useExplorerSide();
  return (
    <SettingRow title={EXPLORER_SIDE_TITLE}>
      <Choice<ExplorerSide>
        label={EXPLORER_SIDE_TITLE}
        items={EXPLORER_SIDES.map(({ value, label }) => ({ value, label }))}
        value={side}
        onValueChange={writeExplorerSide}
      />
    </SettingRow>
  );
}

function LayoutSetting() {
  const layout = useLayoutPreference();
  return (
    <SettingRow title='Layout'>
      <Choice<LayoutPreference>
        label='Layout'
        items={LAYOUT_ORDER.map((value) => ({
          value,
          label: LAYOUT_NAMES[value].label,
          hint: LAYOUT_NAMES[value].hint,
        }))}
        value={layout}
        onValueChange={writeLayoutPreference}
      />
    </SettingRow>
  );
}
