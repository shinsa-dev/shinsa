export const TAB_GROUP_BASE = `import * as React from 'react';

export function TabGroup({ tabs, active, onSelect }: TabGroupProps) {
  return (
    <div className='flex gap-1'>
      {tabs.map((tab) => (
        <button key={tab.id} data-active={tab.id === active} onClick={() => onSelect(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface TabGroupProps {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}
`;

export const TAB_GROUP_NEW = `import * as React from 'react';

export function TabGroup({ tabs, active, onSelect }: TabGroupProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active]);

  return (
    <div ref={listRef} className='flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]'>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-active={tab.id === active}
          className='shrink-0'
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface TabGroupProps {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}
`;

export const KANNA_THEME = `:root {
  --background: #ffffff;
  --panel: #f6f6f7;
  --text: #18191b;
  --muted: #5d6068;
  --border: #e2e3e6;
  --disabled: #9a9ca3;
}

.dark {
  --background: #111113;
  --panel: #18191b;
  --text: #ededef;
  --muted: #a1a4ab;
  --border: #3a3c42;
  --disabled: #6f727a;
}
`;

export const DEFAULTS_BASE = `import type { ModelId, Provider } from './models';

export function resolveDefaultModel(provider: Provider): ModelId {
  switch (provider) {
    case 'claude':
      return 'claude-opus-5-5';
    case 'codex':
      return 'gpt-6';
  }
}
`;

export const DEFAULTS_NEW = `import type { ModelId, Provider } from './models';
import type { UsageWindow } from './usage';

const FALLBACK_THRESHOLD = 0.85;

export function resolveDefaultModel(provider: Provider, usage: UsageWindow | null): ModelId {
  const preferred = resolvePreferredModel(provider);
  if (!usage || usage.used / usage.limit < FALLBACK_THRESHOLD) return preferred;
  return resolveFallbackModel(provider);
}

function resolvePreferredModel(provider: Provider): ModelId {
  switch (provider) {
    case 'claude':
      return 'claude-opus-5-5';
    case 'codex':
      return 'gpt-6';
  }
}

function resolveFallbackModel(provider: Provider): ModelId {
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-5-5';
    case 'codex':
      return 'gpt-6-mini';
  }
}
`;

export const USAGE_NEW = `export interface UsageWindow {
  used: number;
  limit: number;
  resetsAt: number;
}

export function isExhausted(window: UsageWindow, now: number) {
  return window.used >= window.limit && now < window.resetsAt;
}
`;

export const TAB_GROUP_TEST_NEW = `import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react';
import { TabGroup } from './tab-group';

const TABS = Array.from({ length: 40 }, (_, index) => ({ id: \`tab-\${index}\`, label: \`Tab \${index}\` }));

describe('TabGroup', () => {
  it('scrolls the active tab to the centre', () => {
    const scrollIntoView = mock();
    Element.prototype.scrollIntoView = scrollIntoView;
    const view = render(<TabGroup tabs={TABS} active='tab-0' onSelect={() => {}} />);
    view.rerender(<TabGroup tabs={TABS} active='tab-31' onSelect={() => {}} />);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });

  it('keeps every tab at its natural width', () => {
    const view = render(<TabGroup tabs={TABS} active='tab-0' onSelect={() => {}} />);
    expect(view.getAllByRole('button').every((tab) => tab.classList.contains('shrink-0'))).toBe(true);
  });
});
`;

export const DEFAULTS_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { resolveDefaultModel } from './defaults';

const RESETS_AT = Date.UTC(2026, 9, 26, 18);

describe('resolveDefaultModel', () => {
  it('keeps the preferred model below 85%', () => {
    expect(resolveDefaultModel('claude', { used: 84, limit: 100, resetsAt: RESETS_AT })).toBe('claude-opus-5-5');
  });

  it('falls back at 85% of the window', () => {
    expect(resolveDefaultModel('claude', { used: 85, limit: 100, resetsAt: RESETS_AT })).toBe('claude-sonnet-5-5');
    expect(resolveDefaultModel('codex', { used: 85, limit: 100, resetsAt: RESETS_AT })).toBe('gpt-6-mini');
  });

  it('keeps the preferred model without usage data', () => {
    expect(resolveDefaultModel('claude', null)).toBe('claude-opus-5-5');
  });
});
`;
