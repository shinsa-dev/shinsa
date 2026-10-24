import * as React from 'react';

export function useBusy<Key extends string>() {
  const [busy, setBusy] = React.useState<Key | null>(null);

  async function run(key: Key, action: () => Promise<boolean>) {
    setBusy(key);
    try {
      return await action();
    } finally {
      setBusy(null);
    }
  }

  return { busy, run };
}
