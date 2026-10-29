import type { EngineRestartWhen } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { CARD } from '@/components/layout/surface/card.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import {
  ENGINE_ACTION_LABEL,
  type EngineAction,
  type EngineBannerView,
  recordEngineFailure,
  requestEngineRestart,
  resolveEngineView,
  useEngineFailure,
} from '@/lib/connection/engine.ts';
import { useServerHealth } from '@/lib/connection/health.ts';
import {
  checkDesktopUpdates,
  installDesktopUpdate,
  readDesktopUpdate,
  selectDesktopBuild,
} from '@/lib/desktop.ts';

function updateApp() {
  if (readDesktopUpdate().status === 'ready') installDesktopUpdate();
  else checkDesktopUpdates();
}

export function EngineCard({
  banner,
  onAction,
}: {
  banner: EngineBannerView;
  onAction: (action: EngineAction) => void;
}) {
  return (
    <div role='status' className={cn(CARD, 'flex min-w-0 items-center gap-2 py-1.5 ps-3 pe-1.5 text-xs')}>
      <Icon size='sm' name='IconExclamationTriangle' className='text-orange-text' />
      <span className='min-w-0 flex-1 py-0.5 text-fg-3'>{banner.text}</span>
      {banner.actions.map((action, index) => (
        <Button
          key={action}
          size='sm'
          variant={index === banner.actions.length - 1 ? 'primary' : 'secondary'}
          className='shrink-0'
          onClick={() => onAction(action)}
        >
          {ENGINE_ACTION_LABEL[action]}
        </Button>
      ))}
    </div>
  );
}

export function EngineBanner() {
  const health = useServerHealth();
  const failure = useEngineFailure();
  const requested = React.useRef<string | null>(null);
  const view = resolveEngineView(selectDesktopBuild(), health, failure);

  const restart = React.useCallback(async (when: EngineRestartWhen) => {
    try {
      await requestEngineRestart(when);
    } catch (error) {
      recordEngineFailure(describeFailure(error));
    }
  }, []);

  React.useEffect(() => {
    if (!view.automatic) return;
    const key = `${view.key}:${view.automatic}`;
    if (requested.current === key) return;
    requested.current = key;
    void restart(view.automatic);
  }, [view.automatic, view.key, restart]);

  if (!view.banner) return null;
  return (
    <div className={cn(PAGE_COLUMN, 'shrink-0 pt-3')}>
      <EngineCard banner={view.banner} onAction={updateApp} />
    </div>
  );
}
