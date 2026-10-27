import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { EditorHandle } from '@/components/code/editor/code-editor.tsx';
import { CodeNoteView } from '@/components/code/notes.tsx';
import { QuickOpenDialog } from '@/components/code/quick-open.tsx';
import { INSET } from '@/components/layout/surface/card.ts';
import { CodeFence } from '@/components/text/code-fence.tsx';
import { resolveFileIcon, resolveFolderIcon } from '@/lib/code/file-icons.ts';
import { type CodeNote, listFileNotes } from '@/lib/code/notes.ts';
import { listKeptLines } from '@/lib/code/pane.ts';
import {
  SAMPLE_CODE_AFTER,
  SAMPLE_CODE_BEFORE,
  SAMPLE_CODE_COMMENTS,
  SAMPLE_CODE_FINDINGS,
  SAMPLE_CODE_PATH,
  SAMPLE_CODE_PATHS,
  SAMPLE_CODE_RECENT,
  SAMPLE_CODE_SPOTS,
} from './sample-code.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const CodeEditor = React.lazy(() => import('@/components/code/editor/code-editor.tsx'));

const SYNTAX_TOKENS = [
  'keyword',
  'string',
  'number',
  'comment',
  'function',
  'type',
  'property',
  'tag',
  'punctuation',
  'meta',
];

const DIFF_TOKENS = ['added', 'added-strong', 'removed', 'removed-strong'];

const COMMENT_TOKENS = ['alert', 'query', 'todo', 'highlight', 'strike'];

const BETTER_COMMENTS_PATH = 'apps/web/src/lib/review/limits.ts';

const BETTER_COMMENTS_SAMPLE = `// ! Never raise this past the server's own limit.
// ? Should a finding count against it too?
// TODO: read it from the settings once they are synced.
// * The one number every review screen reads.
//// const LIMIT = 40;
// A plain comment stays grey.
export const REVIEW_LIMIT = 24;

/**
 * Counts the notes a review can still take.
 * ! Throws when the draft is already over the limit.
 * todo cover drafts from an older commit
 */
export function countRoom(used: number) {
  if (used > REVIEW_LIMIT) throw new Error('Over the limit.');
  return REVIEW_LIMIT - used; // * What the composer shows
}`;

const ICON_SAMPLES = [
  'main.ts',
  'app.js',
  'view.tsx',
  'tool.py',
  'main.go',
  'lib.rs',
  'data.json',
  'theme.css',
  'README.md',
  'notes.md',
  'index.html',
  'App.swift',
  'App.vue',
  'Page.svelte',
  'ci.yml',
  'run.sh',
  'view.test.ts',
  'schema.sql',
  'Dockerfile',
  '.env',
  'Main.java',
  'index.php',
  'main.c',
  'logo.svg',
  'icon.png',
  'data.csv',
  'package.json',
  'LICENSE',
  'CLAUDE.md',
  'AGENTS.md',
  '.husky/pre-commit',
  'bun.lock',
];

const FOLDER_SAMPLES = ['apps', 'src', 'test', 'docs', 'scripts', 'assets', '.github'];

const FENCE_SAMPLE = SAMPLE_CODE_AFTER.split('\n').slice(11, 29).join('\n');

const NOTES = listFileNotes({
  path: SAMPLE_CODE_PATH,
  ref: null,
  findings: SAMPLE_CODE_FINDINGS,
  comments: SAMPLE_CODE_COMMENTS,
  composer: null,
});

function ignore() {}

function renderNote(note: CodeNote) {
  return (
    <CodeNoteView note={note} onRemove={() => void acknowledgeSample()} onSave={ignore} onCancel={ignore} />
  );
}

function EditorFrame({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={cn(INSET, 'flex w-full min-w-0 flex-col overflow-hidden bg-background', className)}>
      <React.Suspense fallback={null}>{children}</React.Suspense>
    </div>
  );
}

function DiffEditor({ split }: { split: boolean }) {
  const handle = React.useRef<EditorHandle>(null);
  return (
    <EditorFrame className={split ? 'h-[46rem]' : 'h-[72rem]'}>
      <CodeEditor
        path={SAMPLE_CODE_PATH}
        content={SAMPLE_CODE_AFTER}
        original={SAMPLE_CODE_BEFORE}
        split={split}
        editable
        notes={split ? [] : NOTES}
        spots={SAMPLE_CODE_SPOTS}
        keep={listKeptLines(NOTES, SAMPLE_CODE_SPOTS, null, null)}
        focus={null}
        reveal={null}
        onComment={null}
        onEdit={ignore}
        onSave={ignore}
        renderNote={renderNote}
        handle={handle}
      />
    </EditorFrame>
  );
}

function FileEditor({ path, content }: { path: string; content: string }) {
  const handle = React.useRef<EditorHandle>(null);
  return (
    <EditorFrame className='h-[25rem]'>
      <CodeEditor
        path={path}
        content={content}
        original={null}
        split={false}
        editable={false}
        notes={[]}
        spots={[]}
        keep={[]}
        focus={null}
        reveal={null}
        onComment={null}
        onEdit={ignore}
        onSave={ignore}
        renderNote={renderNote}
        handle={handle}
      />
    </EditorFrame>
  );
}

function QuickOpenSpecimen() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant='secondary' size='sm' icon='IconFileText' onClick={() => setOpen(true)}>
        Go to file
      </Button>
      <QuickOpenDialog
        loaded={{ status: 'ready', value: { paths: SAMPLE_CODE_PATHS } }}
        open={open}
        recent={SAMPLE_CODE_RECENT}
        onOpenChange={setOpen}
        onPick={() => {
          setOpen(false);
          void acknowledgeSample();
        }}
      />
    </>
  );
}

export function CodeSpecimens() {
  return (
    <>
      <Specimen label='Code tokens · --code-* in globals.css, read by the editor and by every chat code fence'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-2xs'>
          {SYNTAX_TOKENS.map((token) => (
            <span key={token} style={{ color: `var(--code-${token})` }}>
              {token}
            </span>
          ))}
        </div>
        <div className='flex flex-wrap items-center gap-2 font-mono text-2xs text-fg-4'>
          {DIFF_TOKENS.map((token) => (
            <span
              key={token}
              className='rounded-md px-2 py-0.5'
              style={{ background: `var(--code-${token})` }}
            >
              {token}
            </span>
          ))}
        </div>
      </Specimen>
      <Specimen label='Folder icons · solid while closed, outlined while open, tinted when the name says what they hold'>
        <div className='grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs text-fg-3 sm:grid-cols-7'>
          {FOLDER_SAMPLES.map((name) => (
            <span key={name} className='flex flex-col gap-1'>
              {[false, true].map((open) => (
                <span key={String(open)} className='flex items-center gap-1.5'>
                  <Icon name={resolveFolderIcon(name, open)} size='sm' />
                  {name}
                </span>
              ))}
            </span>
          ))}
        </div>
      </Specimen>
      <Specimen label='File icons · a pastel --file-* tint per language, and a viewed row muting them (file-icons-muted)'>
        {['', 'file-icons-muted text-fg-1'].map((muted) => (
          <div
            key={muted}
            className={cn('grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs text-fg-3 sm:grid-cols-5', muted)}
          >
            {ICON_SAMPLES.map((name) => (
              <span key={name} className='flex items-center gap-1.5'>
                <Icon name={resolveFileIcon(name)} size='sm' />
                {name}
              </span>
            ))}
          </div>
        ))}
      </Specimen>
      <Specimen
        label='The same code in a chat fence (Shiki) and in the editor (CodeMirror): one set of colours'
        className='grid grid-cols-1 items-start gap-3 lg:grid-cols-2'
      >
        <div className='min-w-0'>
          <CodeFence code={FENCE_SAMPLE} language='ts' />
        </div>
        <FileEditor path={SAMPLE_CODE_PATH} content={FENCE_SAMPLE} />
      </Specimen>
      <Specimen label='Better Comments · a comment that starts with !, ?, TODO, * or // (after its marker, or a doc comment’s margin star) takes --code-comment-alert, -query, -todo, -highlight or -strike (app.css), in the editor and every chat fence'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-2xs'>
          {COMMENT_TOKENS.map((token) => (
            <span
              key={token}
              className={cn(token === 'strike' && 'line-through')}
              style={{ color: `var(--code-comment-${token})` }}
            >
              {token}
            </span>
          ))}
        </div>
        <div className='grid grid-cols-1 items-start gap-3 lg:grid-cols-2'>
          <div className='min-w-0'>
            <CodeFence code={BETTER_COMMENTS_SAMPLE} language='ts' />
          </div>
          <FileEditor path={BETTER_COMMENTS_PATH} content={BETTER_COMMENTS_SAMPLE} />
        </div>
      </Specimen>
      <Specimen label='CodeEditor · a diff side by side, the default: the old file on the left, the new side editable (type to try it; in a task each edit saves to the working copy)'>
        <DiffEditor split />
      </Specimen>
      <Specimen label='CodeEditor · the same diff unified: removed lines above where they were, changed words washed, unchanged lines folded (the cursor skips them), a spot’s bar, a blocking finding and a non-blocking one inline, your comment'>
        <DiffEditor split={false} />
      </Specimen>
      <Specimen label='QuickOpenDialog · Go to file (⌘P): every path at the ref, the open tabs first, the matched letters in the accent'>
        <QuickOpenSpecimen />
      </Specimen>
    </>
  );
}
