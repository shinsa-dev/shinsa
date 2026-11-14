import { afterEach, describe, expect, it } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { EngineSourceSettings } from '@/components/settings/engine-source.tsx';
import { installDesktop } from '../../support/desktop.ts';

const STUDIO = { id: 'k3x9', name: 'Studio' };

let app: ReturnType<typeof installDesktop> | null = null;

afterEach(() => {
  app?.restore();
  app = null;
});

describe('the engine in Settings → General', () => {
  it('is not there in a browser or in an app with no engine choice', () => {
    const { container, unmount } = render(<EngineSourceSettings />);
    expect(container.textContent).toBe('');
    unmount();
    app = installDesktop();
    expect(render(<EngineSourceSettings />).container.textContent).toBe('');
  });

  it('on this Mac’s engine, offers a machine on Shinsa Cloud', () => {
    app = installDesktop('window', { kind: 'local' });
    render(<EngineSourceSettings />);
    expect(screen.getByText('This Mac')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this Mac’s engine' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use a machine' }));
    expect(app.sourceCalls).toEqual([null]);
  });

  it('on a machine, names it and offers another machine or this Mac’s engine', () => {
    app = installDesktop('window', { kind: 'cloud', machine: STUDIO });
    render(<EngineSourceSettings />);
    expect(screen.getByText('Studio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this Mac’s engine' }));
    expect(app.sourceCalls).toEqual([null, 'local']);
  });

  it('with no machine chosen yet, offers only this Mac’s engine', () => {
    app = installDesktop('window', { kind: 'cloud', machine: null });
    render(<EngineSourceSettings />);
    expect(screen.getByText('No machine chosen yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose another' })).toBeNull();
  });
});
