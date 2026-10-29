import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { installDesktopUpdate, readDesktopUpdate, subscribeDesktopUpdate } from '@/lib/desktop.ts';
import { describeUpdateHint } from '@/lib/updates.ts';

export function UpdateButtonView({ version, onClick }: { version: string; onClick: () => void }) {
  return (
    <Hint label={describeUpdateHint(version)}>
      <Button size='sm' className='fade-in-0 zoom-in-95 animate-in duration-200' onClick={onClick}>
        Update
      </Button>
    </Hint>
  );
}

export function UpdateButton() {
  const update = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopUpdate);
  if (update.status !== 'ready') return null;
  return <UpdateButtonView version={update.version} onClick={installDesktopUpdate} />;
}
