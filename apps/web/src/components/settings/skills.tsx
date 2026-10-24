import type { ExtensionsSnapshot, SkillSummary } from '@shinsa/core';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import {
  describeGroupCount,
  EXTENSION_LABEL,
  EXTENSION_SECTION,
  type ExtensionPlaces,
  formatTokenEstimate,
  isPluginOff,
  listSkillGroups,
  resolveCostText,
  type SkillGroup,
  SWITCH_LABEL,
} from '@/lib/extensions.ts';
import { FoldingBlock, SETTING_ROW, SettingsEmpty, SettingsGroup, TOKEN_TEXT } from './group.tsx';
import { VirtualRows } from './virtual-rows.tsx';

const SKILL_ROW_HEIGHT = 40;

function SkillRow({
  skill,
  first,
  blocked,
  onChoose,
}: {
  skill: SkillSummary;
  first: boolean;
  blocked: boolean;
  onChoose: (skill: SkillSummary, enabled: boolean) => void;
}) {
  return (
    <div className={cn(SETTING_ROW, 'h-10 gap-1.5', !first && 'border-border border-t')}>
      <Hint label={skill.origin}>
        <span className='min-w-0 shrink-0 cursor-default truncate font-medium text-fg-4 text-xs'>
          {skill.name}
        </span>
      </Hint>
      <Truncate className='min-w-0 flex-1 text-2xs text-fg-2'>{skill.description}</Truncate>
      {blocked ? (
        <span className='shrink-0 text-2xs text-fg-2'>{EXTENSION_LABEL.pluginOff}</span>
      ) : (
        <span className={TOKEN_TEXT}>{resolveCostText(skill, formatTokenEstimate(skill.tokens))}</span>
      )}
      <Switch
        checked={skill.enabled && !blocked}
        disabled={blocked}
        aria-label={SWITCH_LABEL.skills(skill.name)}
        onCheckedChange={(enabled) => onChoose(skill, enabled)}
      />
    </div>
  );
}

function SkillGroupBlock({
  group,
  snapshot,
  actions,
  searching,
}: {
  group: SkillGroup;
  snapshot: ExtensionsSnapshot;
  actions: ExtensionActions;
  searching: boolean;
}) {
  return (
    <FoldingBlock title={group.title} detail={describeGroupCount(group)} forcedOpen={searching}>
      <VirtualRows items={group.skills} rowHeight={SKILL_ROW_HEIGHT} keyOf={(skill) => skill.id}>
        {(skill, index) => (
          <SkillRow
            skill={skill}
            first={index === 0}
            blocked={isPluginOff(snapshot.plugins, skill.plugin)}
            onChoose={(entry, enabled) => void actions.chooseSkill(entry, enabled)}
          />
        )}
      </VirtualRows>
    </FoldingBlock>
  );
}

export function SkillsGroup({
  snapshot,
  skills = snapshot.skills,
  places,
  actions,
  searching = false,
}: {
  snapshot: ExtensionsSnapshot;
  skills?: SkillSummary[];
  places: ExtensionPlaces;
  actions: ExtensionActions;
  searching?: boolean;
}) {
  const groups = listSkillGroups(snapshot, places, skills);
  if (searching && groups.length === 0) return null;
  return (
    <SettingsGroup title={EXTENSION_SECTION.skills} className='gap-1.5'>
      {groups.length === 0 && <SettingsEmpty>{EXTENSION_LABEL.noSkills}</SettingsEmpty>}
      {groups.map((group) => (
        <SkillGroupBlock
          key={group.id}
          group={group}
          snapshot={snapshot}
          actions={actions}
          searching={searching}
        />
      ))}
    </SettingsGroup>
  );
}
