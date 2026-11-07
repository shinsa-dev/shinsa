import * as React from 'react';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { startLocalRelays } from '@/lib/teams/relay.ts';

export function useLocalRelays(start: (onSwitch: () => void) => () => void = startLocalRelays) {
  const [generation, setGeneration] = React.useState(0);
  React.useEffect(() => {
    if (isRemoteBuild()) return;
    return start(() => setGeneration((count) => count + 1));
  }, [start]);
  return generation;
}
