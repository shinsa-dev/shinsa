import type { Task, TaskDiff, TaskRefs } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Sheet, SheetContent, SheetTitle } from '@shinsa/ui/components/sheet';
import { useMediaQuery } from '@shinsa/ui/hooks/use-media-query';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { EditorHandle, EditorSessionHolder } from '@/components/code/editor/code-editor.tsx';
import { EditorPane } from '@/components/code/editor-pane.tsx';
import { Explorer, type ExplorerProps } from '@/components/code/explorer.tsx';
import { QuickOpen } from '@/components/code/quick-open.tsx';
import { ResizeHandle } from '@/components/layout/sidebar/resize-handle.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { useCodeKeyLabel, useCodeKeys } from '@/hooks/use-code-keys.ts';
import { useCodeLocation } from '@/hooks/use-code-location.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { TOKEN_PRIORITY } from '@/lib/code/editor/tokens.ts';
import { resolveEditState } from '@/lib/code/edits.ts';
import { type CodeKey, describeCodeKey } from '@/lib/code/keys.ts';
import {
  type CodeFileRef,
  type CodeMode,
  type OpenOptions,
  resolveFileKey,
  resolveModePatch,
  resolveOpenPatch,
  resolveSearchPatch,
} from '@/lib/code/location.ts';
import { CODE_MARKS, markCode } from '@/lib/code/marks.ts';
import {
  prefetchAncestors,
  prefetchFile,
  prefetchFolder,
  prefetchOtherRefs,
  prefetchPair,
  scheduleIdle,
} from '@/lib/code/prefetch.ts';
import { resolveViewRef } from '@/lib/code/refs.ts';
import { resolveFileSource } from '@/lib/code/source.ts';
import { listCodeCommands } from '@/lib/command/code.ts';
import { listEditorCommands } from '@/lib/command/editor.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { holdLoaded, type Loaded, useTaskDiff } from '@/lib/connection/code.ts';
import {
  toggleViewedFile,
  useExplorerSide,
  useExplorerWidth,
  useHideViewed,
  useUnifiedDiff,
  useViewedFiles,
  writeExplorerSide,
} from '@/lib/preferences/code.ts';
import { resolveFallbackReport } from '@/lib/review/fallback-report.ts';
import { listFindingTargets, listReviewTargets } from '@/lib/review/targets.ts';
import type { ExplorerMode } from '@/lib/tasks/tabs.ts';

const INSTANT = '[&_*]:transition-none! [&_*::before]:transition-none! [&_*::after]:transition-none!';

export function Workbench({ task, refs, modes }: { task: Task; refs: TaskRefs; modes: ExplorerMode[] }) {
  const { location, apply } = useCodeLocation(modes);
  const draft = useReviewDraft();
  const narrow = useMediaQuery('(max-width: 767px)');
  const mac = useCodeKeyLabel();
  const [explorerFloor, setExplorerFloor] = React.useState(0);
  const side = useExplorerSide();
  const width = useExplorerWidth(explorerFloor, side);
  const [unified, toggleSplit] = useUnifiedDiff();
  const split = !unified;
  const [hideViewed, toggleHideViewed] = useHideViewed();
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const editor = React.useRef<EditorHandle>(null);
  const session = React.useRef<EditorSessionHolder['current']>(null);
  React.useEffect(
    () => () => {
      session.current?.destroy();
      session.current = null;
    },
    []
  );
  const gitRef = resolveViewRef(location.ref, refs);
  const reviewing = modes.includes('changes');
  const shownDiff = React.useRef<Loaded<TaskDiff>>({ status: 'idle' });
  const diff = holdLoaded(
    shownDiff.current,
    useTaskDiff(task, reviewing ? refs.base : null, refs.base ? gitRef : null)
  );
  shownDiff.current = diff;
  const diffValue = diff.status === 'ready' ? diff.value : null;
  const report = React.useMemo(
    () => task.report ?? (diffValue ? resolveFallbackReport(diffValue, task.summary ?? task.title) : null),
    [task.report, task.summary, task.title, diffValue]
  );
  const findings = React.useMemo(() => listFindingTargets(task.findings), [task.findings]);
  const targets = React.useMemo(
    () => (report ? [...listReviewTargets(report), ...findings] : findings),
    [report, findings]
  );
  const viewed = useViewedFiles(task.id, reviewing ? gitRef : null);
  const commentCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of draft.comments) counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
    return counts;
  }, [draft.comments]);
  const active = location.active ? resolveFileSource(location.active, diffValue) : null;
  const changed = React.useMemo(() => new Set(diffValue?.files.map((file) => file.path) ?? []), [diffValue]);

  const ahead = React.useRef({ task, refs, diffValue });
  ahead.current = { task, refs, diffValue };
  const activeFile = location.active;
  const activeKey = activeFile ? resolveFileKey(activeFile) : '';
  const diffReady = diffValue !== null;
  React.useEffect(
    () =>
      scheduleIdle(() => {
        const { task: current, refs: currentRefs, diffValue: currentDiff } = ahead.current;
        prefetchOtherRefs(current, currentRefs, gitRef, activeFile, currentDiff, reviewing);
        if (activeFile) prefetchAncestors(current, gitRef, activeFile.path);
      }),
    [activeKey, gitRef, reviewing, diffReady]
  );

  function open(file: CodeFileRef, options: OpenOptions = {}) {
    markCode(CODE_MARKS.open, file.path);
    prefetchFile(task, refs, gitRef, file, diffValue, TOKEN_PRIORITY.visible);
    apply(resolveOpenPatch(file, options));
    setSheetOpen(false);
  }

  function prefetchOpen(file: CodeFileRef) {
    prefetchFile(task, refs, gitRef, file, diffValue);
    if (split && file.kind === 'diff') {
      prefetchPair(task, refs, gitRef, file, diffValue, (source) => session.current?.prefetchPair(source));
    }
  }

  function openLine(path: string, line: number) {
    open({ kind: changed.has(path) ? 'diff' : 'file', path }, { line });
  }

  React.useEffect(() => {
    if (location.active || (reviewing && !diffValue)) return;
    const file = location.mode === 'changes' ? diffValue?.files[0] : undefined;
    if (file) apply(resolveOpenPatch({ kind: 'diff', path: file.path }), { replace: true });
  }, [location, diffValue, reviewing, apply]);

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
      hideViewed,
      side,
      hasEditor: active !== null,
      applyMode,
      run: (key) => run[key](),
      toggleSplit,
      toggleHideViewed,
      toggleSide: () => writeExplorerSide(side === 'left' ? 'right' : 'left'),
    }),
    ...(active
      ? [
          listEditorCommands({
            taskId: task.id,
            mac,
            readOnly: resolveEditState({ task, refs, gitRef, headPath: active.headPath }).reason,
            run: (id) => editor.current?.run(id),
          }),
        ]
      : []),
  ]);

  const explorer: ExplorerProps = {
    task,
    refs,
    gitRef,
    modes,
    location,
    diff,
    commentCounts,
    viewed,
    searchInput,
    onMode: applyMode,
    onRef: (ref) => apply({ ref: ref === refs.head ? null : ref }),
    onChange: (path) => open({ kind: 'diff', path }),
    onFile: (path) => open({ kind: 'file', path }),
    onMatch: openLine,
    onSearch: (search) => apply(resolveSearchPatch(search), { replace: true }),
    onToggleViewed: (path) => toggleViewedFile(task.id, gitRef, path),
    onPrefetch: prefetchOpen,
    onPrefetchPath: (path) => prefetchOpen({ kind: changed.has(path) ? 'diff' : 'file', path }),
    onPrefetchFolder: (dir) => prefetchFolder(task, gitRef, dir),
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
    <div className={cn('flex min-h-0 min-w-0 flex-1', INSTANT, side === 'right' && 'flex-row-reverse')}>
      {narrow ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side={side} showCloseButton={false} className={cn('gap-0 p-0', INSTANT)}>
            <SheetTitle className='sr-only'>Files</SheetTitle>
            <Explorer {...explorer} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          className={cn(
            'relative flex shrink-0 flex-col border-border',
            side === 'left' ? 'border-r' : 'border-l'
          )}
          style={{ width: width.width }}
        >
          <Explorer {...explorer} onFloor={setExplorerFloor} />
          <ResizeHandle
            label='Resize the file list'
            edge={side === 'left' ? 'right' : 'left'}
            onPointerDown={width.startResize}
            onDoubleClick={width.resetWidth}
          />
        </aside>
      )}
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {active ? (
          <EditorPane
            key={`${resolveFileKey(active.file)}@${gitRef}`}
            task={task}
            refs={refs}
            gitRef={gitRef}
            source={active}
            location={location}
            targets={targets}
            split={split}
            onSplit={toggleSplit}
            handle={editor}
            session={session}
            toolbar={explorerButton}
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
        recent={location.active ? [location.active.path] : []}
        onOpenChange={setQuickOpen}
        onPick={(path) => {
          setQuickOpen(false);
          open({ kind: changed.has(path) ? 'diff' : 'file', path });
        }}
        onPrefetch={explorer.onPrefetchPath}
      />
    </div>
  );
}
