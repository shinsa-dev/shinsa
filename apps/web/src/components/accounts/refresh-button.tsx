import * as React from 'react';
import { HintButton } from '@/components/controls/hint-button.tsx';

export function RefreshButton({ label, onRefresh }: { label: string; onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = React.useState(false);

  async function refresh() {
    setBusy(true);
    await onRefresh();
    setBusy(false);
  }

  return (
    <HintButton
      label={label}
      size='icon-sm'
      icon='IconArrowRotateClockwise'
      loading={busy}
      onClick={() => void refresh()}
    />
  );
}
