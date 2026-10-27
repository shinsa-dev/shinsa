import { isWebUrl, type ManualTestTarget, parseTestFile } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';

export type TestTargetView =
  | { kind: 'link'; href: string }
  | { kind: 'file'; path: string; line: number | null; end: number | null }
  | { kind: 'command'; command: string }
  | { kind: 'text'; icon: IconName; text: string };

const TEXT_ICON: Record<ManualTestTarget['kind'], IconName> = {
  url: 'IconGlobe',
  file: 'IconFileText',
  command: 'IconConsole',
  screen: 'IconWindow',
};

function resolveTextTarget(target: ManualTestTarget, text: string): TestTargetView {
  return { kind: 'text', icon: TEXT_ICON[target.kind], text };
}

export function resolveTestTarget(target: ManualTestTarget | null): TestTargetView | null {
  const value = target?.value.trim();
  if (!(target && value)) return null;
  switch (target.kind) {
    case 'url':
      return isWebUrl(value) ? { kind: 'link', href: value } : resolveTextTarget(target, value);
    case 'file': {
      const file = parseTestFile(value);
      return file ? { kind: 'file', ...file } : resolveTextTarget(target, value);
    }
    case 'command':
      return { kind: 'command', command: value };
    case 'screen':
      return resolveTextTarget(target, value);
  }
}
