import { describe, expect, it } from 'bun:test';
import type { ExtensionsSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { McpServersGroup } from '@/components/settings/mcp-servers.tsx';
import type { ExtensionActions } from '@/lib/connection/extensions.ts';
import { createExtensions, createServer } from '../../support/extensions.ts';

const actions = new Proxy({} as ExtensionActions, { get: () => () => Promise.resolve(true) });

const places = { projects: [], repos: [] };

function renderGroup(snapshot: ExtensionsSnapshot) {
  return (
    <TooltipProvider>
      <McpServersGroup snapshot={snapshot} places={places} actions={actions} />
    </TooltipProvider>
  );
}

function createSnapshot(state: 'unchecked' | 'connected') {
  return createExtensions({ servers: [createServer({ id: 'linear' }, { state })] });
}

describe('MCPs', () => {
  it('keeps an open dialog and its typed draft when a check moves the server to another group', async () => {
    const view = render(renderGroup(createSnapshot('unchecked')));
    fireEvent.click(screen.getByRole('button', { name: 'MCP options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Edit/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'linear-2' } });
    view.rerender(renderGroup(createSnapshot('connected')));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('linear-2');
  });

  it('says a server the optimizer leaves out loads when needed, even while it waits for a sign-in', () => {
    const server = createServer(
      { id: 'sentry', source: 'claude', origin: '~/.claude.json', deferred: true },
      { state: 'needs_sign_in' }
    );
    render(renderGroup(createExtensions({ servers: [server] })));
    expect(screen.getByText('Loads when needed · Sign in to measure')).toBeTruthy();
  });
});
