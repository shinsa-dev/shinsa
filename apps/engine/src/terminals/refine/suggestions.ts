import {
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceSuggestion,
} from '@shinsa/core';
import { listDependencyNames, readPackageManifest } from '../../files/manifest.ts';
import { type FolderDigest, REFINE_LIMITS, type RefinedEntry } from '../schema.ts';

export function readFolderDigest(folder: string): FolderDigest {
  const manifest = readPackageManifest(folder);
  const scripts = Object.entries(manifest?.scripts ?? {})
    .slice(0, REFINE_LIMITS.scripts)
    .map(([name, script]) => [name, script.slice(0, REFINE_LIMITS.script)]);
  const dependencies = (manifest ? listDependencyNames(manifest) : []).slice(0, REFINE_LIMITS.dependencies);
  return { folder, scripts: Object.fromEntries(scripts), dependencies };
}

export function serializeRefinePrompt(candidates: ServiceSuggestion[], digests: FolderDigest[]) {
  return JSON.stringify({
    candidates: candidates.map((each, index) => ({
      index,
      name: each.name,
      folder: each.cwd,
      command: each.command,
      source: each.source,
    })),
    folders: digests,
  });
}

export function resolveRefinedSuggestions(
  candidates: ServiceSuggestion[],
  entries: RefinedEntry[]
): ServiceSuggestion[] {
  const resolveText = (value: string, limit: number, fallback: string) => {
    const trimmed = value.trim();
    return trimmed && trimmed.length <= limit ? trimmed : fallback;
  };
  const resolvePreviewUrl = (value: string) => {
    const url = value.trim();
    return url.length <= SERVICE_LIMITS.previewUrl && isServicePreviewUrl(url) ? url : null;
  };
  const resolvePortVariable = (value: string) => {
    const name = value.trim();
    return name && isServiceEnvKey(name) ? name : SERVICE_PORT_VARIABLE;
  };
  const taken = new Set<string>();
  const resolveFreeName = (wanted: string, fallback: string, index: number) => {
    for (const name of [wanted, fallback, `${fallback}-${index + 1}`])
      if (!taken.has(name.toLowerCase())) return name;
    return `${fallback}-${index + 1}-${taken.size}`;
  };
  return candidates.map((candidate, index) => {
    const entry = entries.find((each) => each.index === index);
    const refined = entry
      ? {
          ...candidate,
          name: resolveText(entry.name, SERVICE_LIMITS.name, candidate.name),
          command: resolveText(entry.command, SERVICE_LIMITS.command, candidate.command),
          previewUrl: resolvePreviewUrl(entry.previewUrl),
          portVariable: resolvePortVariable(entry.portVariable),
          recommended: entry.recommended,
        }
      : candidate;
    const name = resolveFreeName(refined.name, candidate.name, index);
    taken.add(name.toLowerCase());
    return { ...refined, name };
  });
}
