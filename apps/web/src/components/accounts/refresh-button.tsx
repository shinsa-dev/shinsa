import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';

export function RefreshButton({ label, onRefresh }: { label: string; onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    setBusy(true);
    await onRefresh();
    setBusy(false);
  }

  return (
    <Hint label={label}>
      <Button
        variant='secondary'
        size='icon-sm'
        icon='IconArrowRotateClockwise'
        aria-label={label}
        loading={busy}
        onClick={() => void refresh()}
      />
    </Hint>
  );
}
