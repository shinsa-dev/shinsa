import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_MANAGERS: { lockfiles: string[]; install: string[] | null }[] = [
  { lockfiles: ['bun.lock', 'bun.lockb'], install: ['bun', 'install'] },
  { lockfiles: ['pnpm-lock.yaml'], install: ['pnpm', 'install', '--frozen-lockfile'] },
  { lockfiles: ['yarn.lock'], install: null },
  { lockfiles: ['package-lock.json'], install: ['npm', 'ci'] },
];

export function resolveInstallCommand(path: string) {
  const managers = PACKAGE_MANAGERS.filter((manager) =>
    manager.lockfiles.some((file) => existsSync(join(path, file)))
  );
  return managers.find((manager) => manager.install)?.install ?? null;
}
