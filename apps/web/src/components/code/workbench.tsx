import type { Attention, Task, TaskRefs } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Sheet, SheetContent, SheetTitle } from '@shinsa/ui/components/sheet';
import { useMediaQuery } from '@shinsa/ui/hooks/use-media-query';
import * as React from 'react';
import type { EditorHandle } from '@/components/code/editor/code-editor.tsx';
import { EditorPane } from '@/components/code/editor-pane.tsx';
import { EditorTabs } from '@/components/code/editor-tabs.tsx';
import { Explorer, type ExplorerProps } from '@/components/code/explorer.tsx';
import { QuickOpen } from '@/components/code/quick-open.tsx';
import { ResizeHandle } from '@/components/layout/sidebar/resize-handle.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { AttentionLabel } from '@/components/status/text.tsx';
import { useCodeKeyLabel, useCodeKeys } from '@/hooks/use-code-keys.ts';
import { useCodeLocation } from '@/hooks/use-code-location.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { type CodeKey, describeCodeKey } from '@/lib/code/keys.ts';
import {
  type CodeMode,
  type CodeTabRef,
  type OpenOptions,
  resolveClosePatch,
  resolveModePatch,
  resolveOpenPatch,
  resolvePinPatch,
  resolveSearchPatch,
  resolveTabKey,
} from '@/lib/code/location.ts';
import { resolveViewRef } from '@/lib/code/refs.ts';
import { resolveTabSource } from '@/lib/code/tabs.ts';
import { listCodeCommands } from '@/lib/command/code.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { useTaskDiff } from '@/lib/connection/code.ts';
import { toggleViewedFile, useExplorerWidth, useSplitDiff, useViewedFiles } from '@/lib/preferences/code.ts';
import { resolveFallbackReport } from '@/lib/review/fallback-report.ts';
import {
  listFindingTargets,
  listReviewTargets,
  type ReviewTarget,
  stepTarget,
} from '@/lib/review/targets.ts';
import type { ExplorerMode } from '@/lib/tasks/tabs.ts';

function SpotStepper({
  index,
  total,
  attention,
  onStep,
}: {
  index: number;
  total: number;
  attention: Attention | null;
  onStep: (delta: 1 | -1) => void;
}) {
  if (total === 0) return null;
  return (
    <span className='flex shrink-0 items-center gap-1'>
      {attention && <AttentionLabel attention={attention} />}
      <span className='text-2xs text-fg-2 tabular-nums max-lg:hidden'>
        {index >= 0 ? `${index + 1} of ${total}` : `${total} spots`}
      </span>
      <Hint label='Previous spot'>
        <Button
          variant='secondary'
          size='icon-sm'
          icon='IconChevronTopMedium'
          aria-label='Previous spot'
          onClick={() => onStep(-1)}
        />
      </Hint>
      <Hint label='Next spot'>
        <Button
          variant='secondary'
          size='icon-sm'
          icon='IconChevronDownMedium'
          aria-label='Next spot'
          onClick={() => onStep(1)}
        />
      </Hint>
    </span>
  );
}

export function Workbench({ task, refs, modes }: { task: Task; refs: TaskRefs; modes: ExplorerMode[] }) {
  const { location, apply } = useCodeLocation(modes);
  const draft = useReviewDraft();
  const narrow = useMediaQuery('(max-width: 767px)');
  const mac = useCodeKeyLabel();
  const width = useExplorerWidth();
  const [split, toggleSplit] = useSplitDiff();
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const editor = React.useRef<EditorHandle>(null);
  const gitRef = resolveViewRef(location.ref, refs);
  const reviewing = modes.includes('changes');
  const diff = useTaskDiff(task, reviewing ? refs.base : null, refs.base ? gitRef : null);
  const diffValue = diff.status === 'ready' ? diff.value : null;
  const report = React.useMemo(
    () => task.report ?? (diffValue ? resolveFallbackReport(diffValue, task.summary ?? task.title) : null),
    [task.report, task.summary, task.title, diffValue]
  );
  const findings = React.useMemo(() => listFindingTargets(task.findings), [task.findings]);
  const targets = React.useMemo(
    () => (report ? [...listReviewTargets(report, location.order), ...findings] : findings),
    [report, location.order, findings]
  );
  const spotIndex = targets.findIndex((target) => target.key === location.spot);
  const viewed = useViewedFiles(task.id, reviewing ? gitRef : null);
  const commentCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of draft.comments) counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
    return counts;
  }, [draft.comments]);
  const sources = location.tabs.map((tab) => resolveTabSource(tab, diffValue));
  const active = location.active ? resolveTabSource(location.active, diffValue) : null;
  const changed = React.useMemo(() => new Set(diffValue?.files.map((file) => file.path) ?? []), [diffValue]);

  function open(tab: CodeTabRef, options: OpenOptions = {}) {
    apply(resolveOpenPatch(location, tab, options));
    setSheetOpen(false);
  }

  function openTarget(target: ReviewTarget) {
    const kind = changed.has(target.file) ? 'diff' : 'file';
    open({ kind, path: target.file }, { line: target.start, end: target.end, spot: target.key });
  }

  function openLine(path: string, line: number) {
    open({ kind: changed.has(path) ? 'diff' : 'file', path }, { line });
  }

  React.useEffect(() => {
    if (location.active || location.tabs.length > 0 || (reviewing && !diffValue)) return;
    const first = location.mode === 'review' ? targets[0] : undefined;
    if (first) {
      const kind = changed.has(first.file) ? 'diff' : 'file';
      apply(
        resolveOpenPatch(
          location,
          { kind, path: first.file },
          { line: first.start, end: first.end, spot: first.key }
        ),
        {
          replace: true,
        }
      );
      return;
    }
    const file = location.mode === 'changes' ? diffValue?.files[0] : undefined;
    if (file) apply(resolveOpenPatch(location, { kind: 'diff', path: file.path }), { replace: true });
  }, [location, targets, changed, diffValue, reviewing, apply]);

  function applyMode(mode: CodeMode) {
    apply(mode === 'search' ? resolveSearchPatch(location) : resolveModePatch(mode, modes));
  }

  const run: Record<CodeKey, () => void> = {
    'quick-open': () => setQuickOpen((current) => !current),
    search: () => {
      applyMode('search');
      if (narrow) setSheetOpen(true);
      requestAnimationFrame(() => searchInput.current?.focus());
    },
    find: () => editor.current?.openFind(),
    'goto-line': () => editor.current?.openGotoLine(),
  };
  useCodeKeys(run);
  useRegisterCommands([
    listCodeCommands({
      taskId: task.id,
      modes,
      mode: location.mode,
      mac,
      split,
      hasEditor: active !== null,
      applyMode,
      run: (key) => run[key](),
      toggleSplit,
    }),
  ]);

  const explorer: ExplorerProps = {
    task,
    refs,
    gitRef,
    modes,
    location,
    diff,
    report,
    findings,
    commentCounts,
    viewed,
    searchInput,
    onMode: applyMode,
    onRef: (ref) => apply({ ref: ref === refs.head ? null : ref }),
    onOrder: (order) => apply({ order: order === 'walkthrough' ? null : order }, { replace: true }),
    onTarget: openTarget,
    onLine: (path, line, side) => openLine(path, side === 'new' ? line : 0),
    onChange: (path, pin) => open({ kind: 'diff', path }, { pin }),
    onFile: (path, pin) => open({ kind: 'file', path }, { pin }),
    onMatch: openLine,
    onSearch: (search) => apply(resolveSearchPatch(search), { replace: true }),
    onToggleViewed: (path) => toggleViewedFile(task.id, gitRef, path),
  };

  const explorerButton = narrow ? (
    <Hint label='Show the files'>
      <Button
        variant='secondary'
        size='icon-sm'
        icon='IconSidebar'
        aria-label='Show the files'
        onClick={() => setSheetOpen(true)}
      />
    </Hint>
  ) : null;

  return (
    <div className='flex min-h-0 min-w-0 flex-1'>
      {narrow ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side='left' showCloseButton={false} className='gap-0 p-0'>
            <SheetTitle className='sr-only'>Files</SheetTitle>
            <Explorer {...explorer} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          className='relative flex shrink-0 flex-col border-border border-r'
          style={{ width: width.width }}
        >
          <Explorer {...explorer} />
          <ResizeHandle
            label='Resize the file list'
            onPointerDown={width.startResize}
            onDoubleClick={width.resetWidth}
          />
        </aside>
      )}
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <EditorTabs
          sources={sources}
          active={location.active}
          preview={location.preview}
          onSelect={(tab) => apply(resolveOpenPatch(location, tab))}
          onPin={(tab) => apply(resolvePinPatch(location, tab))}
          onClose={(tab) => apply(resolveClosePatch(location, tab))}
        />
        {active ? (
          <EditorPane
            key={resolveTabKey(active.tab)}
            task={task}
            refs={refs}
            gitRef={gitRef}
            source={active}
            location={location}
            targets={targets}
            split={split}
            onSplit={toggleSplit}
            handle={editor}
            toolbar={
              <>
                {explorerButton}
                {location.mode === 'review' && (
                  <SpotStepper
                    index={spotIndex}
                    total={targets.length}
                    attention={targets[spotIndex]?.attention ?? null}
                    onStep={(delta) => {
                      const next = stepTarget(targets, spotIndex, delta);
                      if (next) openTarget(next);
                    }}
                  />
                )}
              </>
            }
          />
        ) : (
          <div className='flex min-h-0 flex-1 flex-col'>
            {explorerButton && (
              <div className='flex h-9 items-center border-border border-b px-2'>{explorerButton}</div>
            )}
            <EmptyState
              size='sm'
              icon='IconFiles'
              title='Open a file'
              description={`Pick one in the list, or press ${describeCodeKey('quick-open', mac)} to open any file by name.`}
            />
          </div>
        )}
      </div>
      <QuickOpen
        task={task}
        gitRef={gitRef}
        open={quickOpen}
        recent={location.tabs.map((tab) => tab.path)}
        onOpenChange={setQuickOpen}
        onPick={(path) => {
          setQuickOpen(false);
          open({ kind: changed.has(path) ? 'diff' : 'file', path }, { pin: true });
        }}
      />
    </div>
  );
}
