import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_MANAGERS } from './schema.ts';

export function resolveInstallCommand(path: string) {
  const managers = PACKAGE_MANAGERS.filter((manager) =>
    manager.lockfiles.some((file) => existsSync(join(path, file)))
  );
  return managers.find((manager) => manager.install)?.install ?? null;
}
