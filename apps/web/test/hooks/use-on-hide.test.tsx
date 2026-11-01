import { describe, expect, it, mock } from 'bun:test';
import { act, render } from '@testing-library/react';
import * as React from 'react';
import { useOnHide } from '@/hooks/use-on-hide.ts';

function Probe({ onHide }: { onHide: () => void }) {
  useOnHide(onHide);
  return null;
}

describe('useOnHide', () => {
  it('calls the latest callback when its tree is hidden, not when it renders again', () => {
    const first = mock();
    const latest = mock();
    const page = (mode: 'visible' | 'hidden', onHide: () => void) => (
      <React.Activity mode={mode}>
        <Probe onHide={onHide} />
      </React.Activity>
    );
    const view = render(page('visible', first));
    view.rerender(page('visible', latest));
    expect(latest).not.toHaveBeenCalled();
    act(() => view.rerender(page('hidden', latest)));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
