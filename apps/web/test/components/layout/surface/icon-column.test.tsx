import { describe, expect, it } from 'bun:test';
import type { ChatTool } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { HandoverCard } from '@/components/chat/handover-card.tsx';
import {
  CARD,
  CARD_HEADER,
  CARD_INSET,
  CHAT_COLUMN,
  CHAT_NESTED,
  ICON_SLOT,
  ICON_SLOT_GAP,
} from '@/components/layout/surface/card.ts';
import { resolveDisclosureStrip } from '@/components/layout/surface/disclosure.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { describeTool } from '@/lib/chat/tool-describe.ts';
import { createRun } from '../../../support/state.ts';

function spacing(classes: string, pattern: RegExp) {
  return Number(classes.match(pattern)?.[1]) * 4;
}

function renderPhaseCard() {
  const tool: ChatTool = {
    kind: 'shinsa',
    name: 'complete_phase',
    args: { summary: 'Done.', judgement_calls: [{ call: 'Kept the old name', reason: 'Fewer moves.' }] },
  };
  return render(
    <TooltipProvider>
      <HandoverCard
        call={{
          key: 'c',
          callId: 'c',
          tool,
          description: describeTool(tool),
          result: null,
          images: [],
          failed: false,
          recovery: null,
        }}
        run={createRun({ id: 'r', taskId: 't' })}
        live={false}
      />
    </TooltipProvider>
  );
}

describe('one icon column per card', () => {
  it('sets a card header’s icon in the same 20px slot, on the same 12px inset, as the icons of its rows', () => {
    const view = renderPhaseCard();
    const header = view.container.querySelector('h3') as HTMLElement;
    const body = header.nextElementSibling as HTMLElement;
    expect(spacing(header.className, /\bps-(\d+(?:\.\d+)?)\b/)).toBe(
      spacing(CARD_INSET, /px-(\d+(?:\.\d+)?)/)
    );
    expect(header.className).toContain(ICON_SLOT_GAP);
    expect(spacing(body.className, /\bp-(\d+(?:\.\d+)?)\b/)).toBe(spacing(CARD_INSET, /px-(\d+(?:\.\d+)?)/));
    const slots = [...view.container.querySelectorAll('[data-icon-slot]')];
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.className === ICON_SLOT)).toBe(true);
  });

  it('gives the Overview’s panels the same header', () => {
    const view = render(
      <Panel title='Activity' icon='IconClock'>
        <p>Row</p>
      </Panel>
    );
    const header = view.container.querySelector('h2 [data-disclosure-header]') as HTMLElement;
    const classes = header.className.split(' ');
    const replaced = new Set(['pe-3', 'h-9']);
    for (const token of CARD_HEADER.split(' ')) if (!replaced.has(token)) expect(classes).toContain(token);
    for (const token of resolveDisclosureStrip('band', 'box').split(' ')) expect(classes).toContain(token);
    expect(header.firstElementChild?.className).toBe(ICON_SLOT);
  });

  it('insets the chat’s rows by a card’s border and inset, and rows inside a card by the inset alone', () => {
    const border = CARD.split(' ').includes('border') ? 1 : 0;
    const inset = spacing(CARD_INSET, /px-(\d+(?:\.\d+)?)/);
    expect(spacing(CHAT_COLUMN, /spacing\((\d+(?:\.\d+)?)\)/)).toBe(border + inset);
    expect(spacing(CHAT_NESTED, /spacing\((\d+(?:\.\d+)?)\)/)).toBe(inset);
  });
});
