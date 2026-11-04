import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import {
  SAFE_AREA_BOTTOM,
  SAFE_AREA_SIDES,
  SAFE_AREA_TOP,
} from '@/components/layout/sidebar/compact-bar.tsx';
import { RemoteShell } from '@/routes/remote/shell.tsx';

const dashboard = { signOut: () => Promise.resolve({ ok: true } as const) };

function renderShell(fill: boolean) {
  const view = render(
    <RemoteShell session={null} dashboard={dashboard} fill={fill}>
      <p>Page</p>
    </RemoteShell>
  );
  const shell = view.getByText('Page').closest('main')?.parentElement;
  return { view, className: shell?.className ?? '' };
}

describe('RemoteShell', () => {
  it('keeps clear of the notch on every remote page', () => {
    const { view, className } = renderShell(false);
    expect(className).toContain(SAFE_AREA_TOP);
    expect(className).toContain(SAFE_AREA_SIDES);
    expect(className).not.toContain(SAFE_AREA_BOTTOM);
    view.unmount();
  });

  it('keeps clear of the home bar too when it fills the screen for a shared task', () => {
    const { view, className } = renderShell(true);
    expect(className).toContain(SAFE_AREA_TOP);
    expect(className).toContain(SAFE_AREA_BOTTOM);
    view.unmount();
  });
});
