type Env = Record<string, string | undefined>;

export function resolveBrowserCommand(
  url: string,
  platform: string = process.platform,
  env: Env = process.env
) {
  if (platform === 'darwin') return ['open', url];
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return ['xdg-open', url];
  return null;
}
