import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

interface Prefs {
  windowBounds?: unknown;
  updateChannel?: unknown;
  keptVersion?: unknown;
}

let cached: Prefs | null = null;

function resolveFile() {
  return join(app.getPath('userData'), 'prefs.json');
}

export function readPrefs(): Prefs {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(resolveFile(), 'utf8')) as Prefs;
  } catch {
    cached = {};
  }
  return cached;
}

export function writePrefs(patch: Prefs) {
  cached = { ...readPrefs(), ...patch };
  const file = resolveFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cached, null, 2));
}
