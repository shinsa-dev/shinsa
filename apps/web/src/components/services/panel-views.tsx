import type { Project, ServiceDefinition, ServiceSuggestion, TerminalPlace } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Checkbox } from '@shinsa/ui/components/checkbox';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  LIST_ROW,
  LIST_ROW_LINE,
  LIST_ROW_LINES,
  LIST_ROW_META,
  LIST_ROW_TITLE,
} from '@/components/layout/list-row.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { ServiceFields, useServiceDraft } from '@/components/services/service-form.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import {
  createServiceDraft,
  describeAddServices,
  describeNoSuggestions,
  describeServiceFolder,
  listAllPicks,
  listPickedInputs,
  listRecommendedPicks,
  listServiceFolders,
  resolveServiceForm,
  resolveSuggestionKey,
  type ServiceInput,
  togglePick,
} from '@/lib/terminal/services.ts';

export interface ServicesPanelActions {
  home: string | null;
  focusForms: boolean;
  listPlaces: (projectId: string) => TerminalPlace[];
  listSuggestions: (projectId: string) => Promise<ServiceSuggestion[]>;
  add: (projectId: string, inputs: ServiceInput[]) => Promise<boolean>;
  addOne: (projectId: string, input: ServiceInput) => Promise<boolean>;
  update: (service: ServiceDefinition, input: ServiceInput) => Promise<boolean>;
  remove: (services: ServiceDefinition[]) => Promise<boolean>;
}

export const PANEL_FOOTER = 'flex h-10.25 shrink-0 items-center gap-1 border-border border-t px-2';

export function PanelHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className='flex shrink-0 items-center gap-2 border-border border-b py-3 ps-3 pe-1.5'>
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <h2 className='truncate font-medium text-fg-4 text-xs'>{title}</h2>
        {description && <p className='text-2xs text-fg-2'>{description}</p>}
      </span>
      {children}
    </div>
  );
}

function PanelBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ScrollArea className='min-h-0 flex-1' viewportClassName='h-full'>
      <div className={className}>{children}</div>
    </ScrollArea>
  );
}

function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: string;
  onChange: (projectId: string) => void;
}) {
  if (projects.length < 2) return null;
  return (
    <SelectField
      label='Project'
      size='sm'
      variant='ghost'
      items={projects.map((each) => ({ value: each.id, label: each.name, dot: each.color }))}
      value={value}
      onValueChange={onChange}
    />
  );
}

function SuggestionRow({
  suggestion,
  places,
  picked,
  onToggle,
}: {
  suggestion: ServiceSuggestion;
  places: TerminalPlace[];
  picked: boolean;
  onToggle: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox inside takes the keys
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole row toggles its checkbox
    <div data-highlight-item='' onClick={onToggle} className={cn(LIST_ROW, LIST_ROW_LINES, 'px-1.5')}>
      <span className={ICON_SLOT}>
        <Checkbox
          size='sm'
          variant='outline'
          checked={picked}
          aria-label={`Add ${suggestion.name}`}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={onToggle}
        />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className={LIST_ROW_TITLE}>{suggestion.name}</Truncate>
        <Truncate className={LIST_ROW_META}>
          <span className='font-mono'>{suggestion.command}</span> in{' '}
          {describeServiceFolder(suggestion.cwd, places)}
        </Truncate>
      </span>
    </div>
  );
}

function ServicePicker({
  suggestions,
  places,
  picked,
  onPick,
  onCustom,
}: {
  suggestions: ServiceSuggestion[];
  places: TerminalPlace[];
  picked: string[];
  onPick: (picks: string[]) => void;
  onCustom: () => void;
}) {
  const all = listAllPicks(suggestions, picked);
  return (
    <div className='flex flex-col gap-px p-1.5'>
      <SectionLabel
        count={suggestions.length}
        action={
          suggestions.length > 1 && (
            <Button variant='secondary' size='xs' onClick={() => onPick(all.picks)}>
              {all.label}
            </Button>
          )
        }
        className='h-6 ps-1.5'
      >
        Found in the project
      </SectionLabel>
      <HoverHighlight className='flex flex-col gap-px'>
        <fieldset aria-label='Services found' className='flex min-w-0 flex-col gap-px'>
          {suggestions.map((suggestion) => {
            const key = resolveSuggestionKey(suggestion);
            return (
              <SuggestionRow
                key={key}
                suggestion={suggestion}
                places={places}
                picked={picked.includes(key)}
                onToggle={() => onPick(togglePick(picked, key))}
              />
            );
          })}
        </fieldset>
        <button
          type='button'
          data-highlight-item=''
          onClick={onCustom}
          className={cn(LIST_ROW, LIST_ROW_LINE, 'px-1.5 text-fg-3 text-xs')}
        >
          <span className={ICON_SLOT}>
            <Icon name='IconPlusMedium' size='sm' />
          </span>
          Custom service…
        </button>
      </HoverHighlight>
    </div>
  );
}

function useSuggestions(projectId: string, listSuggestions: ServicesPanelActions['listSuggestions']) {
  const [found, setFound] = React.useState<{ projectId: string; suggestions: ServiceSuggestion[] } | null>(
    null
  );
  const latest = React.useRef(listSuggestions);
  latest.current = listSuggestions;
  React.useEffect(() => {
    let current = true;
    const keep = (suggestions: ServiceSuggestion[]) => {
      if (current) setFound({ projectId, suggestions });
    };
    latest.current(projectId).then(keep, () => keep([]));
    return () => {
      current = false;
    };
  }, [projectId]);
  return found?.projectId === projectId ? found.suggestions : null;
}

function useBusy() {
  const [busy, setBusy] = React.useState(false);
  const run = async (sent: Promise<boolean>, done: () => void) => {
    setBusy(true);
    const ok = await sent;
    setBusy(false);
    if (ok) done();
  };
  return { busy, run };
}

function ServiceFormView({
  mode,
  initial,
  folders,
  autoFocus,
  note,
  onBack,
  onDone,
  onSubmit,
  children,
}: {
  mode: 'custom' | 'edit';
  initial: ServiceDefinition | null;
  folders: ReturnType<typeof listServiceFolders>;
  autoFocus: boolean;
  note?: string;
  onBack: () => void;
  onDone: () => void;
  onSubmit: (input: ServiceInput) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const form = useServiceDraft(createServiceDraft(initial));
  const { busy, run } = useBusy();
  const formId = React.useId();
  const draft = folders.some((folder) => folder.value === form.draft.path)
    ? form.draft
    : { ...form.draft, path: folders[0]?.value ?? '' };
  const copy = resolveServiceForm(mode, mode === 'edit' ? draft.name.trim() : '');

  return (
    <>
      <PanelHeader title={copy.title} description={note ?? copy.description}>
        {children}
      </PanelHeader>
      <PanelBody className='px-3 py-3'>
        <form
          id={formId}
          className='text-fg-3'
          onSubmit={(event) => {
            event.preventDefault();
            const input = form.check(draft);
            if (input) void run(onSubmit(input), onDone);
          }}
        >
          <ServiceFields
            draft={draft}
            errors={form.resolveErrors(draft)}
            folders={folders}
            autoFocus={autoFocus}
            onChange={form.change}
            onLeave={form.leave}
          />
        </form>
      </PanelBody>
      <div className={PANEL_FOOTER}>
        <Button variant='secondary' size='sm' onClick={onBack}>
          Back
        </Button>
        <span className='flex-1' />
        <Button type='submit' size='sm' form={formId} loading={busy}>
          {copy.action}
        </Button>
      </div>
    </>
  );
}

export function AddServicesView({
  projects,
  projectId,
  actions,
  onProject,
  onCustom,
  onBack,
  onDone,
}: {
  projects: Project[];
  projectId: string;
  actions: ServicesPanelActions;
  onProject: (projectId: string) => void;
  onCustom: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const project = projects.find((each) => each.id === projectId);
  const places = actions.listPlaces(projectId);
  const suggestions = useSuggestions(projectId, actions.listSuggestions);
  const [picked, setPicked] = React.useState<string[]>([]);
  const { busy, run } = useBusy();
  const picker = <ProjectSelect projects={projects} value={projectId} onChange={onProject} />;

  React.useEffect(() => {
    if (suggestions) setPicked(listRecommendedPicks(suggestions));
  }, [suggestions]);

  if (suggestions?.length === 0)
    return (
      <ServiceFormView
        key={projectId}
        mode='custom'
        initial={null}
        folders={listServiceFolders(places, [], actions.home, null)}
        autoFocus={false}
        note={describeNoSuggestions(project?.name ?? 'the project')}
        onBack={onBack}
        onDone={onDone}
        onSubmit={(input) => actions.addOne(projectId, input)}
      >
        {picker}
      </ServiceFormView>
    );

  const copy = resolveServiceForm('add', '');
  return (
    <>
      <PanelHeader title={copy.title} description={copy.description}>
        {picker}
      </PanelHeader>
      <PanelBody>
        {suggestions ? (
          <ServicePicker
            suggestions={suggestions}
            places={places}
            picked={picked}
            onPick={setPicked}
            onCustom={onCustom}
          />
        ) : (
          <LoadingLine label='Looking for services' className='h-10 px-3 text-xs' />
        )}
      </PanelBody>
      <div className={PANEL_FOOTER}>
        <Button variant='secondary' size='sm' onClick={onBack}>
          Back
        </Button>
        <span className='flex-1' />
        <Button
          size='sm'
          disabled={!suggestions || picked.length === 0}
          loading={busy}
          onClick={() =>
            void run(actions.add(projectId, listPickedInputs(suggestions ?? [], picked)), onDone)
          }
        >
          {describeAddServices(suggestions ? picked.length : 0)}
        </Button>
      </div>
    </>
  );
}

export function CustomServiceView({
  projectId,
  actions,
  onBack,
  onDone,
}: {
  projectId: string;
  actions: ServicesPanelActions;
  onBack: () => void;
  onDone: () => void;
}) {
  return (
    <ServiceFormView
      mode='custom'
      initial={null}
      folders={listServiceFolders(actions.listPlaces(projectId), [], actions.home, null)}
      autoFocus={actions.focusForms}
      onBack={onBack}
      onDone={onDone}
      onSubmit={(input) => actions.addOne(projectId, input)}
    />
  );
}

export function EditServiceView({
  service,
  actions,
  onBack,
}: {
  service: ServiceDefinition;
  actions: ServicesPanelActions;
  onBack: () => void;
}) {
  return (
    <ServiceFormView
      key={service.id}
      mode='edit'
      initial={service}
      folders={listServiceFolders(actions.listPlaces(service.projectId), [], actions.home, service.cwd)}
      autoFocus={actions.focusForms}
      onBack={onBack}
      onDone={onBack}
      onSubmit={(input) => actions.update(service, input)}
    />
  );
}
