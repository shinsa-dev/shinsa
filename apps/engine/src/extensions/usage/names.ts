export function normalizeServerName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function resolveServerLabel(name: string) {
  return name.split('_').filter(Boolean).at(-1) ?? name;
}
