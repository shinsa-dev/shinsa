import { createContext } from 'react';
import type { DashboardClient } from './dashboard.ts';
import type { DeviceStore } from './devices.ts';

export interface RemoteServices {
  dashboard: DashboardClient;
  devices: DeviceStore;
  worker: ServiceWorkerContainer;
}

export const RemoteServicesContext = createContext<RemoteServices | null>(null);
