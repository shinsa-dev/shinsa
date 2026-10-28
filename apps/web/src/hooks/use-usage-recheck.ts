import * as React from 'react';
import { watchUsage } from '@/lib/connection/accounts.ts';

export function useUsageRecheck(active: boolean) {
  React.useEffect(() => (active ? watchUsage() : undefined), [active]);
}
