import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { CodeBlock, CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { spyOnCommands } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';

let commands: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  commands = spyOnCommands();
});

afterEach(() => {
  commands.restore();
});

function renderBlock(node: React.ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

function readCorner(container: HTMLElement) {
  return container.querySelector('[data-slot="code-corner"]') as HTMLElement;
}

describe('CodeBlock', () => {
  it('copies the whole block from its corner, and says so', async () => {
    renderBlock(
      <CodeBlock copy={'bun install\nbun test'}>
        <pre>bun install</pre>
      </CodeBlock>
    );
    const button = screen.getByRole('button', { name: 'Copy' });
    expect(await findTooltipText(button)).toBe('Copy');
    fireEvent.click(button);
    expect(commands.copied).toHaveBeenCalledWith('bun install\nbun test');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined());
  });

  it('shows its copy button on hover, on keyboard focus and always on touch, on a surface of its own', () => {
    const { container } = renderBlock(
      <CodeBlock copy='gh auth login'>
        <pre>gh auth login</pre>
      </CodeBlock>
    );
    const corner = readCorner(container);
    expect(corner.className).toContain('opacity-0');
    expect(corner.className).toContain('group-hover/code:opacity-100');
    expect(corner.className).toContain('has-[:focus-visible]:opacity-100');
    expect(corner.className).toContain('pointer-coarse:opacity-100');
    expect(corner.className).toContain('to-bg-2');
    const surface = screen.getByRole('button', { name: 'Copy' }).parentElement as HTMLElement;
    expect(surface.className).toContain('bg-bg-2');
    expect(surface.className).toContain('border-border');
  });

  it('puts Run in terminal beside Copy in the same corner, revealed the same way, and nothing below the block', () => {
    const { container } = renderBlock(
      <CommandRunnerProvider runner={{ run: () => undefined, folder: '/tmp/shop' }}>
        <Markdown text={'```sh run\ngh auth login\n```'} />
      </CommandRunnerProvider>
    );
    const corner = readCorner(container);
    expect(corner.className).toContain('opacity-0');
    expect(corner.className).toContain('group-hover/code:opacity-100');
    const surface = screen.getByRole('button', { name: 'Run in terminal' }).parentElement as HTMLElement;
    expect(surface).toBe(screen.getByRole('button', { name: 'Copy' }).parentElement as HTMLElement);
    expect(corner.parentElement?.nextElementSibling).toBeNull();
  });

  it('centres the corner beside a single line, out of its way, and keeps it at the top right of several', () => {
    const { container } = renderBlock(
      <Markdown text={'```sh\nbun run dev\n```\n\n```sh\nbun install\nbun run dev\n```'} />
    );
    const [single, multi] = [...container.querySelectorAll('[data-slot="code-corner"]')] as HTMLElement[];
    expect(single?.dataset.corner).toBe('centre');
    expect(single?.className).not.toContain('absolute');
    expect(single?.parentElement?.className).toContain('items-center');
    expect(single?.previousElementSibling?.className).toContain('flex-1');
    expect(multi?.dataset.corner).toBe('top');
    expect(multi?.className).toContain('absolute');
    expect(multi?.className).toContain('to-bg-2');
  });

  it('copies a command without its prompt', () => {
    renderBlock(<Markdown text={'```console\n$ bun dev\nready\n```'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(commands.copied).toHaveBeenCalledWith('bun dev\nready');
  });

  it('has no corner when there is nothing to copy', () => {
    const { container } = renderBlock(
      <CodeBlock copy={null}>
        <pre>empty</pre>
      </CodeBlock>
    );
    expect(readCorner(container)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('gives every markdown fence the same block and copy button', () => {
    const { container } = renderBlock(<Markdown text={'```ts\nconst a = 1;\n```\n\n```\nplain\n```'} />);
    expect(container.querySelectorAll('[data-slot="code-corner"]')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
    expect(readCorner(container).className).toContain('opacity-0');
  });
});
