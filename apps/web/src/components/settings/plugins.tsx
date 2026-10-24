import type { ExtensionsSnapshot, PluginSummary } from '@shinsa/core';
import { Switch } from '@shinsa/ui/components/switch';
import { Hint } from '@/components/overlays/hint.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import {
  describePluginContents,
  EXTENSION_LABEL,
  EXTENSION_SECTION,
  formatTokenEstimate,
  SWITCH_LABEL,
} from '@/lib/extensions.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';

function PluginRow({
  plugin,
  onChoose,
}: {
  plugin: PluginSummary;
  onChoose: (plugin: PluginSummary, enabled: boolean) => void;
}) {
  return (
    <div className={SETTING_ROW}>
      <Hint label={`${describePluginContents(plugin)} · ${plugin.origin}`}>
        <span className='min-w-0 flex-1 cursor-default truncate font-medium text-fg-4 text-xs'>
          {plugin.name}
        </span>
      </Hint>
      <span className={TOKEN_TEXT}>{formatTokenEstimate(plugin.tokens)}</span>
      <Switch
        checked={plugin.enabled}
        aria-label={SWITCH_LABEL.plugins(plugin.name)}
        onCheckedChange={(enabled) => onChoose(plugin, enabled)}
      />
    </div>
  );
}

export function PluginsGroup({
  snapshot,
  plugins = snapshot.plugins,
  actions,
  searching = false,
}: {
  snapshot: ExtensionsSnapshot;
  plugins?: PluginSummary[];
  actions: ExtensionActions;
  searching?: boolean;
}) {
  if (searching && plugins.length === 0) return null;
  return (
    <SettingsGroup title={EXTENSION_SECTION.plugins}>
      {plugins.length === 0 && <SettingsEmpty>{EXTENSION_LABEL.noPlugins}</SettingsEmpty>}
      {plugins.map((plugin) => (
        <PluginRow
          key={plugin.id}
          plugin={plugin}
          onChoose={(entry, enabled) => void actions.choosePlugin(entry, enabled)}
        />
      ))}
    </SettingsGroup>
  );
}
