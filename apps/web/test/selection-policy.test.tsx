import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { resolveSelectionRegion } from '@shinsa/ui/lib/selection';
import { render } from '@testing-library/react';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { ErrorFallback } from '@/components/errors/fallback.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { CodeBlock } from '@/components/text/code-block.tsx';
import { FindingNote } from '@/components/text/finding-note.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { notPersisted } from '@/lib/preferences/disclosure.ts';

function isSelectable(node: Node | null) {
  return resolveSelectionRegion(node) !== null;
}

function findText(container: HTMLElement, text: string) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(text)) return node;
  }
  throw new Error(`No text node with ${text}`);
}

describe('the selection policy', () => {
  it('makes prose, code, a message and an error selectable', () => {
    const view = render(
      <TooltipProvider>
        <Markdown text='The **approach** is two secrets per app.' />
        <CodeBlock copy='bun test'>
          <pre>bun test</pre>
        </CodeBlock>
        <UserMessage persistId={notPersisted('a test message')} text='Rotate the key without downtime' />
        <ErrorFallback
          size='inline'
          error={{ message: 'socket closed', details: 'stack' }}
          onRetry={() => {}}
        />
      </TooltipProvider>
    );
    for (const text of ['approach', 'bun test', 'Rotate the key', 'socket closed']) {
      expect(isSelectable(findText(view.container, text))).toBe(true);
    }
  });

  it('leaves chrome unselectable: rows, titles, inline labels and buttons', () => {
    const view = render(
      <TooltipProvider>
        <ListRow title='Rename review targets' meta='SMP-2 · Changes to review' onClick={() => {}} />
        <InlineMarkdown text='Sign outgoing webhooks' />
        <FindingNote label='Optional' tone='neutral' body='The client stays set.' fix={null} />
        <ErrorFallback size='inline' error={{ message: 'boom', details: 'stack' }} onRetry={() => {}} />
      </TooltipProvider>
    );
    for (const text of ['Rename review targets', 'Sign outgoing webhooks', 'Optional', 'Try again']) {
      expect(isSelectable(findText(view.container, text))).toBe(false);
    }
    expect(isSelectable(findText(view.container, 'The client stays set.'))).toBe(true);
  });
});
