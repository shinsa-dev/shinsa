export const APP_IDENTITY = {
  appId: 'studio.overclock.shinsa',
  appName: 'Shinsa',
  scheme: 'shinsa',
  port: 7446,
  configDir: 'shinsa',
  command: 'shinsa',
} as const;

export function resolveEngineLabel(appId: string) {
  return `${appId}.engine`;
}
