export { type CommandReceipt, type SurfaceClient, type SurfaceHookSecrets } from './schema.ts';

export function resolveCommandKey(key: string, sent: number) {
  return sent === 0 ? key : `${key}:${sent}`;
}
