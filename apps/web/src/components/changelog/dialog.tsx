import { type ChangelogRelease, listChangeGroups } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import {
  CHANGELOG_COPY,
  CHANGELOG_ICON,
  closeChangelog,
  describeChangelogSince,
  describeReleaseDate,
  describeReleaseTitle,
  listShownReleases,
  openChangelog,
  useChangelogView,
  useWhatsNew,
} from '@/lib/changelog.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';

function ReleaseCard({ release }: { release: ChangelogRelease }) {
  const date = describeReleaseDate(release);
  return (
    <section className={cn(CARD, 'flex flex-col gap-2.5 p-3')} data-release={release.version ?? 'unreleased'}>
      <header className='flex items-baseline justify-between gap-2'>
        <h3 className='text-sm font-medium text-fg-4'>{describeReleaseTitle(release)}</h3>
        {date && <span className='shrink-0 text-2xs text-fg-2'>{date}</span>}
      </header>
      {listChangeGroups(release.changes).map((group) => (
        <div key={group.kind} className='flex flex-col gap-1'>
          <h4 className='text-2xs font-medium text-fg-2'>{group.title}</h4>
          <ul className='flex list-disc flex-col gap-1 ps-4 text-xs text-fg-3 marker:text-fg-1'>
            {group.changes.map((change) => (
              <li key={change.slug} className='selectable'>
                {change.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ChangelogBody() {
  const view = useChangelogView();
  const releases = listShownReleases(view);
  if (!view.changelog) {
    if (view.failure) return <p className={cn('text-xs', TONE_TEXT.red)}>{view.failure}</p>;
    return <Spinner size='sm' />;
  }
  if (releases.length === 0) return <p className='text-xs text-fg-2'>{CHANGELOG_COPY.empty}</p>;
  return (
    <div className='flex w-full flex-col gap-2 text-left'>
      {releases.map((release) => (
        <ReleaseCard key={release.version ?? 'unreleased'} release={release} />
      ))}
    </div>
  );
}

export function ChangelogDialog() {
  const view = useChangelogView();
  return (
    <Dialog
      open={view.open}
      onOpenChange={(open) => {
        if (!open) closeChangelog();
      }}
    >
      <DialogContent className='w-[min(32rem,calc(100vw-2rem))]'>
        <DialogHeader className='px-6'>
          <DialogTitle>{CHANGELOG_COPY.title}</DialogTitle>
          <DialogDescription>{describeChangelogSince(view.since)}</DialogDescription>
        </DialogHeader>
        <DialogCloseButton />
        <ChangelogBody />
      </DialogContent>
    </Dialog>
  );
}

function WhatsNewButtonView({ since, onClick }: { since: string; onClick: () => void }) {
  return (
    <Hint label={describeChangelogSince(since)}>
      <Button
        variant='secondary'
        size='sm'
        icon={CHANGELOG_ICON}
        className='animate-in duration-200 fade-in-0 zoom-in-95'
        onClick={onClick}
      >
        {CHANGELOG_COPY.button}
      </Button>
    </Hint>
  );
}

export function WhatsNewButton() {
  const { releases, seen } = useWhatsNew();
  if (releases.length === 0 || seen === null) return null;
  return <WhatsNewButtonView since={seen} onClick={() => openChangelog(seen)} />;
}
