import { createContext } from 'react';
import type { TeamKeyStore } from '@/lib/teams/join.ts';
import type { DashboardClient } from './dashboard.ts';
import type { DeviceStore } from './devices.ts';

export interface RemoteServices {
  dashboard: DashboardClient;
  devices: DeviceStore;
  teamKeys: TeamKeyStore;
  worker: ServiceWorkerContainer;
}

export const RemoteServicesContext = createContext<RemoteServices | null>(null);
