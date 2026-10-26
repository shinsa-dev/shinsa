import { dirname, join } from 'node:path';

export interface ShinsaBundle {
  version: string;
  commit: string | null;
  stateVersion: string;
  sdk: { version: string; claudeCodeVersion: string };
  root: string;
  bin: string;
}

interface BundleFacts {
  version: string | undefined;
  commit: string | undefined;
  stateVersion: string | undefined;
  sdkVersion: string | undefined;
  sdkClaudeVersion: string | undefined;
}

export function resolveBundle(
  facts: BundleFacts = {
    version: process.env.SHINSA_BUILD_VERSION,
    commit: process.env.SHINSA_BUILD_COMMIT,
    stateVersion: process.env.SHINSA_BUILD_STATE_VERSION,
    sdkVersion: process.env.SHINSA_BUILD_SDK_VERSION,
    sdkClaudeVersion: process.env.SHINSA_BUILD_SDK_CLAUDE_VERSION,
  },
  execPath = process.execPath
): ShinsaBundle | null {
  if (!facts.version || !facts.stateVersion || !facts.sdkVersion || !facts.sdkClaudeVersion) return null;
  const bin = dirname(execPath);
  return {
    version: facts.version,
    commit: facts.commit || null,
    stateVersion: facts.stateVersion,
    sdk: { version: facts.sdkVersion, claudeCodeVersion: facts.sdkClaudeVersion },
    root: dirname(bin),
    bin,
  };
}

export function resolveBundlePath(bundle: ShinsaBundle, ...parts: string[]) {
  return join(bundle.root, ...parts);
}

export const BUNDLE = resolveBundle();
