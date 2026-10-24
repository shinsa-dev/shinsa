import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoHeader, InfoPopover, InfoRow, InfoSection } from '@/components/overlays/info-popover.tsx';
import {
  dismissHealth,
  HEALTH_COPY,
  type HealthBannerView,
  useHealthBanner,
} from '@/lib/connection/health.ts';

export function HealthCard({ banner, onDismiss }: { banner: HealthBannerView; onDismiss: () => void }) {
  return (
    <div role='status' className={cn(CARD, 'flex min-w-0 items-center gap-2 py-1.5 ps-3 pe-1.5 text-xs')}>
      <Icon name='IconExclamationTriangle' className='size-3.5 shrink-0 text-orange-text' />
      <span className='min-w-0 flex-1 text-fg-3'>{banner.text}</span>
      <InfoPopover
        className='w-80'
        render={
          <button
            type='button'
            className='shrink-0 cursor-default text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
          />
        }
        trigger={HEALTH_COPY.details}
      >
        <InfoHeader title={HEALTH_COPY.title} description={HEALTH_COPY.description} />
        <InfoSection>
          {banner.problems.map((problem) => (
            <InfoRow
              key={problem.key}
              icon='IconExclamationTriangle'
              iconClassName='text-orange-text'
              label={problem.label}
              value={problem.detail}
            />
          ))}
        </InfoSection>
      </InfoPopover>
      <Hint label={HEALTH_COPY.dismiss}>
        <Button
          variant='secondary'
          size='icon-xs'
          icon='IconCrossSmall'
          aria-label={HEALTH_COPY.dismiss}
          onClick={onDismiss}
        />
      </Hint>
    </div>
  );
}

export function HealthBanner() {
  const banner = useHealthBanner();
  if (!banner) return null;
  return (
    <div className={cn(PAGE_COLUMN, 'shrink-0 pt-3')}>
      <HealthCard banner={banner} onDismiss={dismissHealth} />
    </div>
  );
}
