import { Card } from '@shinsa/ui/components/card';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { resolveSectionId } from '@/lib/settings.ts';

export const SETTING_ROW = 'flex min-h-10 items-center gap-4 py-1 pr-1.5 pl-2';

export const SETTINGS_SHELF = 'flex flex-col divide-y divide-border rounded-item bg-bg-a1';

export const TOKEN_TEXT = 'shrink-0 text-2xs text-fg-2 tabular-nums';

const BLOCK_HEADER = 'flex h-8 items-center gap-1.5 pr-1.5 pl-2';

export function SettingsGroup({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={resolveSectionId(title)} className='flex scroll-mt-6 flex-col gap-1'>
      <SectionLabel action={action} className='px-1'>
        {title}
      </SectionLabel>
      <SettingsCard className={className}>{children}</SettingsCard>
    </section>
  );
}

export function SettingsCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Card className={cn('gap-0 p-1.5', className)}>{children}</Card>;
}

export function SettingRow({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 items-center gap-1.5 truncate text-fg-4 text-xs'>{title}</div>
      <div className='flex shrink-0 items-center gap-1.5'>{children}</div>
    </div>
  );
}

export function PathRow({
  icon,
  iconLabel,
  title,
  path,
  action,
}: {
  icon: IconName;
  iconLabel: string;
  title: string;
  path?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <Hint label={iconLabel}>
        <span className='grid size-3.5 shrink-0 place-items-center'>
          <Icon size='sm' name={icon} />
        </span>
      </Hint>
      <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
        <Truncate className='min-w-0 shrink-0 text-fg-4 text-xs'>{title}</Truncate>
        {path && <Truncate className='min-w-0 text-2xs text-fg-2'>{path}</Truncate>}
      </span>
      {action}
    </div>
  );
}

export function SettingsEmpty({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className={SETTING_ROW}>
      <span className='min-w-0 flex-1 text-fg-2 text-xs'>{children}</span>
      {action}
    </div>
  );
}

export function SettingsBlock({ header, children }: { header: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className='flex flex-col'>
      <div className={BLOCK_HEADER}>{header}</div>
      {children && <div className={SETTINGS_SHELF}>{children}</div>}
    </div>
  );
}

export function FoldingBlock({
  title,
  detail,
  status,
  startsOpen = false,
  forcedOpen = false,
  children,
}: {
  title: string;
  detail: string;
  status?: { icon: IconName; tone: Tone };
  startsOpen?: boolean;
  forcedOpen?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = React.useState(startsOpen);
  const open = expanded || forcedOpen;
  return (
    <div className='flex flex-col'>
      <DisclosureHeader
        open={open}
        onToggle={() => setExpanded((value) => !value)}
        strip='block'
        chevron='glyph'
        className='gap-1.5 pl-2 text-xs'
      >
        {status && (
          <Icon size='sm' name={status.icon} className={cn('-translate-y-px', TONE_TEXT[status.tone])} />
        )}
        <span className='min-w-0 truncate font-medium text-fg-4'>{title}</span>
        <span className={TOKEN_TEXT}>{detail}</span>
      </DisclosureHeader>
      {open && <div className={SETTINGS_SHELF}>{children}</div>}
    </div>
  );
}
