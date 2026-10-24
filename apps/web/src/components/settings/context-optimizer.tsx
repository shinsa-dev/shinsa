import type { ExtensionsSnapshot } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import {
  describeServerToggled,
  EXTENSION_LABEL,
  listOptimizerDayItems,
  listRecommendations,
  type Recommendation,
} from '@/lib/extensions.ts';
import { SETTING_ROW, SettingRow, SettingsBlock, SettingsGroup, TOKEN_TEXT } from './group.tsx';

const RECOMMENDATION_LIMIT = 5;

function RecommendationRow({
  recommendation,
  optimizing,
  actions,
}: {
  recommendation: Recommendation;
  optimizing: boolean;
  actions: ExtensionActions;
}) {
  const { server } = recommendation;
  return (
    <div className={SETTING_ROW}>
      <Truncate className='min-w-0 shrink-0 font-medium text-fg-4 text-xs'>{recommendation.name}</Truncate>
      <Truncate className='min-w-0 flex-1 text-right text-2xs text-fg-2 tabular-nums'>
        {recommendation.detail}
      </Truncate>
      {optimizing ? (
        <span className={TOKEN_TEXT}>{EXTENSION_LABEL.loadsWhenNeeded}</span>
      ) : (
        server && (
          <Button
            variant='secondary'
            size='sm'
            onClick={() =>
              void actions.choose(server, { enabled: false }, describeServerToggled(server.name, false))
            }
          >
            {EXTENSION_LABEL.turnOff}
          </Button>
        )
      )}
    </div>
  );
}

export function ContextOptimizerGroup({
  snapshot,
  actions,
  now = Date.now(),
}: {
  snapshot: ExtensionsSnapshot;
  actions: ExtensionActions;
  now?: number;
}) {
  const { optimizer } = snapshot;
  const recommendations = listRecommendations(snapshot, now);
  return (
    <SettingsGroup title={EXTENSION_LABEL.optimizerSection}>
      <SettingRow
        title={
          <Hint label={EXTENSION_LABEL.optimizerOnHint}>
            <span className='cursor-default truncate'>{EXTENSION_LABEL.optimizerOn}</span>
          </Hint>
        }
      >
        <Switch
          checked={optimizer.enabled}
          aria-label={EXTENSION_LABEL.optimizerOn}
          onCheckedChange={(enabled) => void actions.chooseOptimizer(optimizer, { enabled })}
        />
      </SettingRow>
      <SettingRow title={EXTENSION_LABEL.optimizerDays}>
        <SelectField
          label={EXTENSION_LABEL.optimizerDays}
          items={listOptimizerDayItems(optimizer.days)}
          value={String(optimizer.days)}
          onValueChange={(days) => void actions.chooseOptimizer(optimizer, { days: Number(days) })}
          className='w-28'
        />
      </SettingRow>
      <SettingRow title={EXTENSION_LABEL.optimizerSkills}>
        <Switch
          checked={optimizer.skills}
          aria-label={EXTENSION_LABEL.optimizerSkills}
          onCheckedChange={(skills) => void actions.chooseOptimizer(optimizer, { skills })}
        />
      </SettingRow>
      <SettingsBlock
        header={<span className='font-medium text-2xs text-fg-2'>{EXTENSION_LABEL.notUsedLately}</span>}
      >
        {snapshot.usage.readAt === null && (
          <div className={`${SETTING_ROW} text-2xs text-fg-2`}>{EXTENSION_LABEL.readingUsage}</div>
        )}
        {snapshot.usage.readAt !== null && recommendations.length === 0 && (
          <div className={`${SETTING_ROW} text-2xs text-fg-2`}>{EXTENSION_LABEL.allUsed}</div>
        )}
        {recommendations.slice(0, RECOMMENDATION_LIMIT).map((recommendation) => (
          <RecommendationRow
            key={recommendation.id}
            recommendation={recommendation}
            optimizing={optimizer.enabled}
            actions={actions}
          />
        ))}
      </SettingsBlock>
    </SettingsGroup>
  );
}
