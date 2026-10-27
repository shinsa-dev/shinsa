export type AppFlavor = 'stable' | 'canary';

export interface FlavorIdentity {
  flavor: AppFlavor;
  appId: string;
  appName: string;
  scheme: string;
  port: number;
  configDir: string;
  command: string;
}

export const APP_FLAVORS: Record<AppFlavor, FlavorIdentity> = {
  stable: {
    flavor: 'stable',
    appId: 'studio.overclock.shinsa',
    appName: 'Shinsa',
    scheme: 'shinsa',
    port: 7446,
    configDir: 'shinsa',
    command: 'shinsa',
  },
  canary: {
    flavor: 'canary',
    appId: 'studio.overclock.shinsa.canary',
    appName: 'Shinsa Canary',
    scheme: 'shinsa-canary',
    port: 7447,
    configDir: 'shinsa-canary',
    command: 'shinsa-canary',
  },
};

export function parseAppFlavor(value: unknown): AppFlavor | null {
  return value === 'stable' || value === 'canary' ? value : null;
}

export function resolveAppFlavor(value: unknown): FlavorIdentity {
  return APP_FLAVORS[parseAppFlavor(value) ?? 'stable'];
}

export function resolveEngineLabel(appId: string) {
  return `${appId}.engine`;
}
