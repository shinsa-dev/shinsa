import type { BrowserSite, SourceBrowserAnswer, SourceBrowserId } from '@shinsa/core/engine-api/schema';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Field, FieldDescription } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { toast } from '@shinsa/ui/components/sonner';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import {
  COPY_DIALOG_DESCRIPTION,
  COPY_DIALOG_TITLE,
  COPY_KEYCHAIN_HINT,
  describeCopyButton,
  describeCopyDone,
  filterSites,
  resolveDefaultSource,
  toggleSite,
} from '@/lib/browser.ts';
import type { BrowserActions } from '@/lib/connection/browser.ts';
import { describeFailure } from '@/lib/connection/commands.ts';

type Loaded<T> =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; value: T };

function useLoaded<T>(read: (() => Promise<T>) | null, key: string) {
  const [loaded, setLoaded] = React.useState<Loaded<T>>({ status: 'loading' });
  React.useEffect(() => {
    if (!read) return;
    let current = true;
    setLoaded({ status: 'loading' });
    read().then(
      (value) => {
        if (current) setLoaded({ status: 'ready', value });
      },
      (error: unknown) => {
        if (current) setLoaded({ status: 'failed', message: describeFailure(error) });
      }
    );
    return () => {
      current = false;
    };
  }, [key]);
  return loaded;
}

function SiteRow({
  site,
  checked,
  onToggle,
}: {
  site: BrowserSite;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className='flex min-h-8 items-center gap-2 px-2'>
      <Checkbox id={id} size='sm' checked={checked} aria-label={site.site} onCheckedChange={onToggle} />
      <label htmlFor={id} className='min-w-0 flex-1 truncate text-xs text-fg-4'>
        {site.site}
      </label>
      {!site.signedIn && <span className='shrink-0 text-2xs text-fg-2'>Not signed in</span>}
    </div>
  );
}

function SiteList({
  loaded,
  query,
  chosen,
  onToggle,
}: {
  loaded: Loaded<ReadonlyArray<BrowserSite>>;
  query: string;
  chosen: ReadonlySet<string>;
  onToggle: (site: string, on: boolean) => void;
}) {
  if (loaded.status === 'loading')
    return <LoadingLine label='Reading your browser’s sites' className='p-2' />;
  if (loaded.status === 'failed')
    return (
      <p role='alert' className='p-2 text-xs text-destructive'>
        {loaded.message}
      </p>
    );
  const shown = query.trim()
    ? filterSites(loaded.value, query)
    : loaded.value.filter((site) => site.signedIn);
  if (shown.length === 0) return <p className='p-2 text-xs text-fg-2'>No site matches.</p>;
  return (
    <div className='flex flex-col'>
      {shown.map((site) => (
        <SiteRow
          key={site.site}
          site={site}
          checked={chosen.has(site.site)}
          onToggle={(on) => onToggle(site.site, on)}
        />
      ))}
    </div>
  );
}

function SourcePicker({
  sources,
  source,
  onSource,
}: {
  sources: ReadonlyArray<SourceBrowserAnswer>;
  source: SourceBrowserId;
  onSource: (source: SourceBrowserId) => void;
}) {
  return (
    <SelectField
      label='Browser'
      size='sm'
      align='start'
      value={source}
      onValueChange={onSource}
      items={sources.map((entry) => ({
        value: entry.id,
        label: entry.name,
        hint: entry.isDefault ? 'Default' : undefined,
      }))}
    />
  );
}

export function BrowserCopyDialog({
  control,
  projectId,
  actions,
  initialSites = [],
  onCopied,
}: {
  control: DialogControl;
  projectId: string;
  actions: BrowserActions;
  initialSites?: ReadonlyArray<string>;
  onCopied: () => void;
}) {
  const sources = useLoaded(actions.listSources, 'sources');
  const [picked, setPicked] = React.useState<SourceBrowserId | null>(null);
  const source =
    picked ?? (sources.status === 'ready' ? (resolveDefaultSource(sources.value)?.id ?? null) : null);
  const sites = useLoaded(source ? () => actions.listSourceSites(source) : null, source ?? '');
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(() => new Set(initialSites));
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function copy() {
    if (!source || chosen.size === 0) return;
    setBusy(true);
    try {
      toast.success(describeCopyDone(await actions.copy(projectId, source, [...chosen])));
      control.onOpenChange(false);
      onCopied();
    } catch (error) {
      toast.error(describeFailure(error));
    }
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{COPY_DIALOG_TITLE}</DialogTitle>
          <DialogDescription>{COPY_DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        {sources.status === 'failed' && (
          <p role='alert' className='text-xs text-destructive'>
            {sources.message}
          </p>
        )}
        {sources.status === 'ready' && sources.value.length === 0 && (
          <p className='text-xs text-fg-2'>
            No Chromium browser found on this Mac. Dia, Chrome, Arc, Brave and Edge can be copied from.
          </p>
        )}
        {sources.status === 'ready' && source && (
          <Field className='w-full'>
            <div className='flex items-center gap-1.5'>
              <SourcePicker
                sources={sources.value}
                source={source}
                onSource={(next) => {
                  setPicked(next);
                  setChosen(new Set());
                }}
              />
              <Input
                size='sm'
                value={query}
                placeholder='Find a site'
                aria-label='Find a site'
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className={cn(INSET, 'max-h-72 overflow-y-auto bg-bg-a1 py-1')}>
              <SiteList
                loaded={sites}
                query={query}
                chosen={chosen}
                onToggle={(site, on) => setChosen((current) => toggleSite(current, site, on))}
              />
            </div>
            <FieldDescription>{COPY_KEYCHAIN_HINT}</FieldDescription>
          </Field>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button disabled={!source || chosen.size === 0} loading={busy} onClick={() => void copy()}>
            {describeCopyButton(chosen.size)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
