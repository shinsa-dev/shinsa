import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CodeDiff } from '@/components/text/code-diff.tsx';
import type { DiffSource } from '@/lib/code/diff-view.ts';

function readRows(container: HTMLElement) {
  const host = container.querySelector('diffs-container');
  return [...(host?.shadowRoot?.querySelectorAll('[data-line]') ?? [])].map(
    (row) => `${row.getAttribute('data-line-type')} ${row.textContent}`
  );
}

async function renderDiff(source: DiffSource, numbered = false) {
  const view = render(<CodeDiff source={source} numbered={numbered} />);
  await waitFor(() => expect(readRows(view.container).length).toBeGreaterThan(0), { timeout: 15_000 });
  return view;
}

describe('CodeDiff', () => {
  setDefaultTimeout(20_000);

  it('shows a changed line as removed and added between unchanged lines', async () => {
    const view = await renderDiff({ kind: 'files', path: 'a.ts', before: 'a\nb\nc', after: 'a\nB\nc' });
    expect(readRows(view.container)).toEqual([
      'context a',
      'change-deletion b',
      'change-addition B',
      'context c',
    ]);
  });

  it('shows lines that were only added or only removed', async () => {
    const added = await renderDiff({ kind: 'files', path: 'a.ts', before: 'a', after: 'a\nb' });
    expect(readRows(added.container)).toEqual(['context a', 'change-addition b']);
    added.unmount();
    const removed = await renderDiff({ kind: 'files', path: 'a.ts', before: 'a\nb', after: 'a' });
    expect(readRows(removed.container)).toEqual(['context a', 'change-deletion b']);
  });

  it('shows a new file as every line added, with line numbers', async () => {
    const view = await renderDiff({ kind: 'files', path: 'new.ts', before: null, after: 'one\ntwo' }, true);
    expect(readRows(view.container)).toEqual(['change-addition one', 'change-addition two']);
    const host = view.container.querySelector('diffs-container');
    expect(host?.shadowRoot?.querySelector('[data-column-number]')?.textContent).toBe('1');
  });

  it('names where a renamed file came from above its changes', async () => {
    const view = await renderDiff({
      kind: 'patch',
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      hunks: '@@ -4,2 +4,2 @@\n keep\n-old\n+new',
      binary: false,
    });
    expect(screen.getByText('Renamed from src/old.ts.')).toBeTruthy();
    expect(readRows(view.container)).toEqual(['context keep', 'change-deletion old', 'change-addition new']);
  });

  it('says a binary file is not shown and renders no lines', () => {
    const view = render(
      <CodeDiff source={{ kind: 'patch', path: 'logo.png', previousPath: null, hunks: '', binary: true }} />
    );
    expect(screen.getByText('A binary file, not shown as text.')).toBeTruthy();
    expect(view.container.querySelector('diffs-container')).toBeNull();
  });

  it('folds a long diff after fourteen lines until you ask for the rest', async () => {
    const after = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
    const view = await renderDiff({ kind: 'files', path: 'long.ts', before: null, after });
    const frame = view.container.querySelector('diffs-container')?.parentElement as HTMLElement;
    expect(frame.style.maxHeight).toBe('252px');
    fireEvent.click(screen.getByRole('button', { name: 'Show 16 more lines' }));
    expect(frame.style.maxHeight).toBe('');
    expect(screen.queryByRole('button', { name: /more lines/ })).toBeNull();
  });

  it('shows a short diff whole', async () => {
    const view = await renderDiff({ kind: 'files', path: 'a.ts', before: 'a', after: 'b' });
    const frame = view.container.querySelector('diffs-container')?.parentElement as HTMLElement;
    expect(frame.style.maxHeight).toBe('');
    expect(screen.queryByRole('button', { name: /more lines/ })).toBeNull();
  });
});
