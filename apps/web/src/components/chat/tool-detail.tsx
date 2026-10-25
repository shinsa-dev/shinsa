import type { ChatTodoStatus, ChatToolArgs } from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CodeLines, DetailBlock, HighlightedBlock, ShowMoreButton } from '@/components/chat/code-lines.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { CodeDiff } from '@/components/text/code-diff.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { humanize } from '@/lib/chat/tool-describe.ts';
import {
  CODE_ARGUMENTS,
  formatStructured,
  isLongMarkdown,
  parseNumbered,
  resolveToolResult,
  splitArguments,
  splitLines,
} from '@/lib/chat/tool-output.ts';
import { resolveLanguage } from '@/lib/code/highlight.ts';
import { countLineChanges } from '@/lib/code/line-changes.ts';

const TODO_MARK: Record<ChatTodoStatus, { icon: IconName; className: string; label: string }> = {
  completed: { icon: 'IconCheckCircle2', className: 'text-primary-text', label: 'Done' },
  in_progress: { icon: 'IconLoadingCircle', className: 'text-primary-text', label: 'In progress' },
  pending: { icon: 'IconCircleDotted', className: 'text-fg-2', label: 'Not started' },
};

function StructuredOutput({
  text,
  structured,
  label,
}: {
  text: string;
  structured: string;
  label?: React.ReactNode;
}) {
  const lines = React.useMemo(() => splitLines(structured).map((line) => ({ text: line })), [structured]);
  return (
    <DetailBlock label={label} copy={text}>
      <CodeLines lines={lines} language='json' wrap />
    </DetailBlock>
  );
}

function OutputText({ text, failed, label }: { text: string; failed: boolean; label?: React.ReactNode }) {
  const structured = React.useMemo(() => formatStructured(text), [text]);
  if (structured) return <StructuredOutput text={text} structured={structured} label={label} />;
  return (
    <DetailBlock label={label} copy={text}>
      <CodeLines
        lines={splitLines(text).map((line) => ({ text: line }))}
        wrap
        tone={failed ? 'failed' : 'default'}
      />
    </DetailBlock>
  );
}

function ClampedMarkdown({ text, label }: { text: string; label?: React.ReactNode }) {
  const [expanded, setExpanded] = React.useState(false);
  const clamped = isLongMarkdown(text) && !expanded;
  return (
    <DetailBlock label={label} copy={text}>
      <div className={cn('px-3 py-2.5', clamped && 'max-h-64 overflow-hidden')}>
        <Markdown text={text} className='prose-chat' />
      </div>
      {clamped && <ShowMoreButton label='Show all' onClick={() => setExpanded(true)} />}
    </DetailBlock>
  );
}

function resolveResultLabel(call: ToolCall, label: string | undefined) {
  if (!call.failed) return label;
  return call.recovery === null ? 'Error' : 'Handed back';
}

function ToolResult({ call, running, label }: { call: ToolCall; running: boolean; label?: string }) {
  const view = resolveToolResult(call);
  const broken = call.failed && call.recovery === null;
  switch (view.kind) {
    case 'pending':
      return running ? (
        <ShimmeringText text='Waiting for the result…' className='text-2xs text-fg-2' />
      ) : (
        <span className='text-2xs text-fg-2'>No output.</span>
      );
    case 'empty':
      return view.label && <span className='text-2xs text-fg-2'>{view.label}</span>;
    case 'markdown':
      return <ClampedMarkdown text={view.text} label={label} />;
    case 'text':
      return <OutputText text={view.text} failed={broken} label={resolveResultLabel(call, label)} />;
  }
}

function ReadDetail({ call, path, running }: { call: ToolCall; path: string; running: boolean }) {
  const parsed = React.useMemo(() => parseNumbered(call.result ?? ''), [call.result]);
  const plain = call.failed || call.result === null || call.images.length > 0;
  if (plain) return <ToolResult call={call} running={running} />;
  return (
    <DetailBlock copy={parsed.code}>
      <CodeLines
        lines={parsed.lines}
        language={resolveLanguage(path)}
        gutter={parsed.numbered ? 'numbers' : null}
      />
    </DetailBlock>
  );
}

function EditDiff({
  before,
  after,
  path,
  labelled,
}: {
  before: string;
  after: string;
  path: string;
  labelled: boolean;
}) {
  const source = React.useMemo(
    () => ({ kind: 'files' as const, path, before, after }),
    [path, before, after]
  );
  return (
    <DetailBlock label={labelled && <DiffStats {...countLineChanges(before, after)} />} copy={after}>
      <CodeDiff source={source} />
    </DetailBlock>
  );
}

function EditDetail({
  call,
  path,
  hunks,
  running,
}: {
  call: ToolCall;
  path: string;
  hunks: { before: string; after: string }[];
  running: boolean;
}) {
  if (hunks.length === 0) return <ToolResult call={call} running={running} />;
  return (
    <>
      {hunks.map((hunk, position) => (
        <EditDiff
          // biome-ignore lint/suspicious/noArrayIndexKey: hunks are positional
          key={position}
          before={hunk.before}
          after={hunk.after}
          path={path}
          labelled={hunks.length > 1}
        />
      ))}
      {call.failed && <ToolResult call={call} running={running} />}
    </>
  );
}

function WriteDetail({
  call,
  path,
  content,
  running,
}: {
  call: ToolCall;
  path: string;
  content: string;
  running: boolean;
}) {
  const source = React.useMemo(
    () => ({ kind: 'files' as const, path, before: null, after: content }),
    [path, content]
  );
  if (!content) return <ToolResult call={call} running={running} />;
  return (
    <>
      <DetailBlock copy={content}>
        <CodeDiff source={source} numbered />
      </DetailBlock>
      {call.failed && <ToolResult call={call} running={running} />}
    </>
  );
}

function TodoDetail({ todos }: { todos: { text: string; status: ChatTodoStatus }[] }) {
  if (todos.length === 0) return null;
  return (
    <ul className='flex flex-col gap-1.5'>
      {todos.map((todo, index) => {
        const mark = TODO_MARK[todo.status];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: to-dos are positional
          <li key={index} className='flex min-w-0 items-start gap-2 text-xs'>
            <Hint label={<span className={mark.className}>{mark.label}</span>}>
              <span className='mt-px grid w-fit shrink-0 place-items-center'>
                <Icon size='sm' name={mark.icon} aria-label={mark.label} className={mark.className} />
              </span>
            </Hint>
            <span
              className={cn('min-w-0', todo.status === 'completed' ? 'text-fg-2 line-through' : 'text-fg-4')}
            >
              {todo.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TaskDetail({ call, prompt, running }: { call: ToolCall; prompt: string | null; running: boolean }) {
  const reply = call.result?.trim();
  return (
    <>
      {prompt && <ClampedMarkdown text={prompt} />}
      {reply && !call.failed ? (
        <ClampedMarkdown text={reply} />
      ) : (
        <ToolResult call={call} running={running} />
      )}
    </>
  );
}

function ArgumentBlock({ name, value }: { name: string; value: unknown }) {
  if (typeof value === 'string' && CODE_ARGUMENTS.has(name)) {
    return <HighlightedBlock code={value} language='javascript' label={humanize(name)} />;
  }
  if (typeof value === 'string')
    return <HighlightedBlock code={value} language={null} label={humanize(name)} wrap />;
  return (
    <HighlightedBlock code={JSON.stringify(value, null, 2)} language='json' label={humanize(name)} wrap />
  );
}

function ArgumentsDetail({ args }: { args: ChatToolArgs }) {
  const { inline, blocks } = splitArguments(args);
  return (
    <>
      {inline.length > 0 && (
        <dl className='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-2xs'>
          {inline.map(([name, value]) => (
            <React.Fragment key={name}>
              <dt className='text-fg-2'>{humanize(name)}</dt>
              <dd className='min-w-0 break-words font-mono text-fg-4'>{String(value)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {blocks.map(([name, value]) => (
        <ArgumentBlock key={name} name={name} value={value} />
      ))}
    </>
  );
}

export function ToolDetail({ call, running }: { call: ToolCall; running: boolean }) {
  const { tool } = call;
  switch (tool.kind) {
    case 'command':
      return (
        <>
          {tool.command && <HighlightedBlock code={tool.command} language='bash' label='Command' wrap />}
          <ToolResult call={call} running={running} label='Output' />
        </>
      );
    case 'read':
      return <ReadDetail call={call} path={tool.path} running={running} />;
    case 'edit':
      return <EditDetail call={call} path={tool.path} hunks={tool.hunks} running={running} />;
    case 'write':
      return <WriteDetail call={call} path={tool.path} content={tool.content} running={running} />;
    case 'todo':
      return <TodoDetail todos={tool.todos} />;
    case 'task':
      return <TaskDetail call={call} prompt={tool.prompt} running={running} />;
    case 'search':
    case 'fetch':
      return <ToolResult call={call} running={running} />;
    case 'browser':
    case 'mcp':
    case 'shinsa':
    case 'other':
      return (
        <>
          <ArgumentsDetail args={tool.args} />
          <ToolResult call={call} running={running} label='Result' />
        </>
      );
  }
}
