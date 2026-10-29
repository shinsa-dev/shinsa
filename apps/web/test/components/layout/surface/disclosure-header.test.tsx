import { describe, expect, it, spyOn } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Round, Task } from '@shinsa/core';
import { buttonVariants } from '@shinsa/ui/components/button';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render } from '@testing-library/react';
import type * as React from 'react';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { resolveDisclosureStrip } from '@/components/layout/surface/disclosure.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { RoundHeader } from '@/components/overview/round-header.tsx';
import { FoldingBlock } from '@/components/settings/group.tsx';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { createDisclosureId, readDisclosure, useDisclosure } from '@/lib/preferences/disclosure.ts';
import { createRound } from '../../../support/rounds.ts';
import { createTask } from '../../../support/state.ts';

const SOURCE = join(import.meta.dir, '../../../../src');

const PRIMITIVE = 'components/layout/surface/disclosure-header.tsx';

const ROW_DISCLOSURES: Record<string, string> = {
  'components/chat/chat-line.tsx': 'a chat line is one row button, not a header',
  'components/code/tree-row.tsx': 'a tree item, opened by the tree',
  'components/chat/user-message.tsx': 'Show more under a message',
  'components/evidence/evidence-text.tsx': 'Show the output of a test or check run, a button in its caption',
  'components/task/heading.tsx': 'the request under the title is itself the button',
  'components/settings/agents.tsx': 'the inline Per role toggle',
  'components/onboarding/projects.tsx': 'the inline Repositories toggle at the end of a suggested project',
  'components/settings/mcp-server-row.tsx': 'a settings row with a leading chevron, not a header',
};

const MENU_BUTTONS: Record<string, string> = {
  'components/controls/lazy-menu.tsx':
    'a menu button before its menu mounts reads as closed, as Base UI’s does',
};

const HEADERS = [
  'components/layout/surface/panel.tsx',
  'components/text/change-snippet.tsx',
  'components/settings/group.tsx',
  'components/roadmap/group.tsx',
  'components/layout/compact-section.tsx',
  'components/layout/page/section-label.tsx',
  'components/chat/live-card.tsx',
  'components/chat/delegation-card.tsx',
  'components/overview/round-header.tsx',
];

function listSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSources(path);
    return entry.endsWith('.tsx') ? [relative(SOURCE, path)] : [];
  });
}

function header(view: ReturnType<typeof render>) {
  return view.container.querySelector('[data-disclosure-header]') as HTMLElement;
}

function expanded(view: ReturnType<typeof render>) {
  const trigger = header(view);
  return (
    trigger.matches('[aria-expanded]') ? trigger : trigger.querySelector('[aria-expanded]')
  )?.getAttribute('aria-expanded');
}

function assertOneTrigger(view: ReturnType<typeof render>) {
  expect(view.container.querySelectorAll('[aria-expanded]:not([role=combobox])')).toHaveLength(1);
  expect(view.container.querySelector('button button, button a, a button')).toBeNull();
}

function assertKitChevron(view: ReturnType<typeof render>) {
  const chevron = view.container.querySelector('[data-disclosure-chevron]') as HTMLElement;
  expect(chevron.dataset.slot).toBe('button');
  const classes = chevron.className.split(' ');
  for (const token of buttonVariants({ variant: 'secondary', size: 'icon-xs' }).split(' ')) {
    if (!token.startsWith('size-')) expect(classes).toContain(token);
  }
  expect(chevron.className).not.toContain('group-hover/disclosure');
  expect(chevron.className).not.toContain('group-active/disclosure');
  expect(chevron.className).not.toMatch(/transition-(colors|all)/);
  return chevron;
}

function Toggled({ action, interactive }: { action?: React.ReactNode; interactive?: boolean }) {
  const disclosure = useDisclosure(createDisclosureId('ui', 'details'), false);
  return (
    <DisclosureHeader
      disclosure={disclosure}
      label='details'
      strip='band'
      chevron='box'
      action={action}
      interactive={interactive}
    >
      <span>Details</span>
    </DisclosureHeader>
  );
}

describe('every collapsible header', () => {
  it('goes through DisclosureHeader, and only rows that are their own button set aria-expanded by hand', () => {
    const hand = listSources(SOURCE).filter(
      (file) =>
        file !== PRIMITIVE &&
        !(file in MENU_BUTTONS) &&
        readFileSync(join(SOURCE, file), 'utf8').includes('aria-expanded')
    );
    expect(hand.sort()).toEqual(Object.keys(ROW_DISCLOSURES).sort());
    for (const file of HEADERS) {
      const source = readFileSync(join(SOURCE, file), 'utf8');
      expect(source).toContain('<DisclosureHeader');
      expect(source).not.toContain('CollapseToggle');
    }
  });

  it('takes a strip whenever it ends in a chevron, so the chevron sits on the shared inset', () => {
    for (const file of listSources(SOURCE)) {
      const source = readFileSync(join(SOURCE, file), 'utf8');
      for (const [usage] of source.matchAll(/<DisclosureHeader\b[^>]*?>/gs)) {
        if (/\bchevron=/.test(usage)) expect(usage).toMatch(/\bstrip=/);
      }
    }
  });
});

describe('a disclosure header', () => {
  it('is one button when nothing in it acts on its own', () => {
    const view = render(<Toggled />);
    assertOneTrigger(view);
    expect(header(view).tagName).toBe('BUTTON');
    expect(header(view).getAttribute('aria-label')).toBe('Expand details');
    const chevron = assertKitChevron(view);
    expect(chevron.tagName).toBe('SPAN');
    expect(chevron.getAttribute('aria-hidden')).toBe('true');
    expect(chevron.tabIndex).toBe(-1);
    fireEvent.click(chevron);
    expect(expanded(view)).toBe('true');
    fireEvent.click(chevron);
    fireEvent.click(view.getByText('Details'));
    expect(expanded(view)).toBe('true');
    expect(header(view).getAttribute('aria-label')).toBe('Collapse details');
    for (const token of resolveDisclosureStrip('band', 'box').split(' ')) {
      expect(header(view).className.split(' ')).toContain(token);
    }
  });

  it('folds from anywhere on it, keeps its actions’ clicks and puts the keyboard on the chevron', () => {
    const acted: string[] = [];
    const view = render(
      <Toggled
        action={
          <button type='button' onClick={() => acted.push('action')}>
            Act
          </button>
        }
      />
    );
    assertOneTrigger(view);
    expect(header(view).tagName).toBe('DIV');
    fireEvent.click(view.getByText('Details'));
    expect(expanded(view)).toBe('true');
    fireEvent.click(view.getByText('Act'));
    expect(acted).toEqual(['action']);
    expect(expanded(view)).toBe('true');
    const chevron = view.getByRole('button', { name: 'Collapse details' });
    expect(assertKitChevron(view)).toBe(chevron);
    expect(chevron.tagName).toBe('BUTTON');
    fireEvent.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header(view));
    expect(expanded(view)).toBe('true');
  });
});

describe('the headers that fold', () => {
  it('fold a panel from its title and keep its action’s click', () => {
    const acted: string[] = [];
    const view = render(
      <Panel
        persistId={createDisclosureId('ui', 'panel', 'changes')}
        title='What changed'
        icon='IconCodeLines'
        action={
          <button type='button' onClick={() => acted.push('review')}>
            Open the review
          </button>
        }
      >
        <p>Body</p>
      </Panel>
    );
    assertOneTrigger(view);
    fireEvent.click(view.getByText('What changed'));
    expect(view.queryByText('Body')).toBeNull();
    fireEvent.click(view.getByText('Open the review'));
    expect(acted).toEqual(['review']);
    expect(view.queryByText('Body')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Expand what changed' }));
    expect(view.getByText('Body')).toBeTruthy();
  });

  it('keep a panel folded when it mounts again', () => {
    const summary = createDisclosureId('task', 't', 'overview', 'panel', 'summary');
    const panel = () => (
      <Panel persistId={summary} title='Summary' icon='IconNote1'>
        <p>Body</p>
      </Panel>
    );
    const first = render(panel());
    fireEvent.click(first.getByText('Summary'));
    first.unmount();
    const again = render(panel());
    expect(again.queryByText('Body')).toBeNull();
    expect(expanded(again)).toBe('false');
    expect(again.getByRole('button', { name: 'Expand summary' })).toBeTruthy();
  });

  it('show a panel’s passive meta inside the trigger', () => {
    const view = render(
      <Panel
        persistId={createDisclosureId('ui', 'panel', 'delegations')}
        title='Delegations'
        icon='IconAgents'
        meta='2 running'
      >
        <p>Body</p>
      </Panel>
    );
    assertOneTrigger(view);
    fireEvent.click(view.getByText('2 running'));
    expect(view.queryByText('Body')).toBeNull();
  });

  it('fold a change snippet from its header, its place a link that does not fold it', () => {
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      (async () => new Response(null, { status: 503 })) as unknown as typeof globalThis.fetch
    );
    for (const repoId of [null, 'r-1']) {
      const view = render(
        <TooltipProvider>
          <ChangeSnippet
            persistId={createDisclosureId('ui', 'snippet', String(repoId))}
            task={createTask({ id: 'snippet', repoId })}
            path='src/a.ts'
            start={3}
            end={4}
          />
        </TooltipProvider>
      );
      assertOneTrigger(view);
      expect(header(view).className).toContain(resolveDisclosureStrip('strip', 'box'));
      expect(expanded(view)).toBe('false');
      fireEvent.click(header(view));
      expect(expanded(view)).toBe('true');
      fireEvent.click(header(view));
      if (repoId) {
        fireEvent.click(view.getByText('src/a.ts'));
        expect(expanded(view)).toBe('false');
      }
      view.unmount();
    }
    fetch.mockRestore();
  });

  it('fold a settings block and a section from anywhere on their header', () => {
    const view = render(
      <FoldingBlock
        persistId={createDisclosureId('settings', 'skills', 'group', 'all')}
        title='Skills'
        detail='3 of 12 on'
      >
        <p>Rows</p>
      </FoldingBlock>
    );
    assertOneTrigger(view);
    expect(header(view).className).toContain(resolveDisclosureStrip('block', 'glyph'));
    fireEvent.click(view.getByText('3 of 12 on'));
    expect(view.getByText('Rows')).toBeTruthy();
    view.unmount();
    const waiting = createDisclosureId('home', 'section', 'waiting');
    function Waiting() {
      return (
        <SectionLabel disclosure={useDisclosure(waiting, true)} count={2}>
          Waiting
        </SectionLabel>
      );
    }
    const section = render(<Waiting />);
    assertOneTrigger(section);
    expect(section.container.querySelector('h2 > button')).toBeTruthy();
    fireEvent.click(header(section));
    expect(readDisclosure(waiting)).toBe(false);
  });

  it('fold a round from its row, its shipping choice and pull request acting on their own', () => {
    const id = createDisclosureId('task', 't', 'overview', 'round', '2');
    function Header({ shown, folded }: { shown: Task; folded: Round }) {
      return <RoundHeader task={shown} round={folded} disclosure={useDisclosure(id, false)} />;
    }
    const round = createRound({
      number: 2,
      status: 'waiting',
      startedAt: null,
      pullRequest: null,
      outcome: null,
    });
    const task = createTask({
      id: 't',
      pullRequest: {
        number: 12,
        url: 'https://github.com/o/r/pull/12',
        state: 'open',
        checks: 'passing',
        unresolvedComments: 0,
        mergeable: true,
        updatedAt: 0,
      },
      rounds: [createRound({ number: 1 }), round],
    });
    const view = render(
      <TooltipProvider>
        <Header shown={task} folded={round} />
      </TooltipProvider>
    );
    assertOneTrigger(view);
    fireEvent.click(view.getByText('Round 2 work'));
    expect(readDisclosure(id)).toBe(true);
    fireEvent.click(view.getByRole('combobox', { name: 'How round 2 ships' }));
    expect(readDisclosure(id)).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Collapse round 2' }));
    expect(readDisclosure(id)).toBe(false);
  });
});
