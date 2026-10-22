import type { CommandOf } from '../commands/index.ts';
import { DomainError, type Settings } from '../model/index.ts';
import type { Decider } from './decider.ts';

const AREA_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'teal', 'amber', 'red'] as const;

function isSame(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertArea(decider: Decider, areaId: string | null | undefined) {
  if (areaId && !decider.state.areas[areaId]) throw new DomainError('area_not_found', `No area ${areaId}`);
}

function isCount(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function assertSettings(patch: Partial<Settings>) {
  if (patch.maxFixRounds !== undefined && patch.maxFixRounds !== null && !isCount(patch.maxFixRounds)) {
    throw new DomainError('settings_invalid', 'Fix rounds must be a whole number of 1 or more.');
  }
  if (patch.attentionLimit !== undefined && !isCount(patch.attentionLimit)) {
    throw new DomainError('settings_invalid', 'The attention limit must be a whole number of 1 or more.');
  }
}

function upsertArea(decider: Decider, name: string) {
  const existing = Object.values(decider.state.areas).find(
    (area) => area.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.id;
  const id = decider.context.newId();
  const color = AREA_COLORS[Object.keys(decider.state.areas).length % AREA_COLORS.length] ?? 'blue';
  decider.emit({ type: 'area.written', area: { id, name, color } });
  return id;
}

export function registerRepo(decider: Decider, command: CommandOf<'repo.register'>) {
  if (Object.values(decider.state.repos).some((repo) => repo.path === command.repo.path)) return;
  const areaName = command.areaName?.trim();
  const areaId = areaName ? upsertArea(decider, areaName) : null;
  decider.emit({ type: 'repo.registered', repo: { ...command.repo, areaId, id: decider.context.newId() } });
}

export function updateRepo(decider: Decider, command: CommandOf<'repo.update'>) {
  const repo = decider.state.repos[command.repoId];
  if (!repo) throw new DomainError('repo_not_found', `No repository ${command.repoId}`);
  assertArea(decider, command.patch.areaId);
  const updated = { ...repo, ...command.patch };
  if (isSame(updated, repo)) return;
  decider.emit({ type: 'repo.updated', repo: updated });
}

export function removeRepo(decider: Decider, command: CommandOf<'repo.remove'>) {
  if (!decider.state.repos[command.repoId]) return;
  decider.emit({ type: 'repo.removed', repoId: command.repoId });
}

export function writeArea(decider: Decider, command: CommandOf<'area.write'>) {
  const name = command.area.name.trim();
  if (name.length === 0) throw new DomainError('area_name_required', 'Name the area.');
  const existing = command.area.id ? decider.state.areas[command.area.id] : undefined;
  if (existing && existing.name === name && existing.color === command.area.color) return;
  decider.emit({
    type: 'area.written',
    area: { id: command.area.id ?? decider.context.newId(), name, color: command.area.color },
  });
}

export function removeArea(decider: Decider, command: CommandOf<'area.remove'>) {
  if (!decider.state.areas[command.areaId]) return;
  for (const repo of Object.values(decider.state.repos)) {
    if (repo.areaId === command.areaId)
      decider.emit({ type: 'repo.updated', repo: { ...repo, areaId: null } });
  }
  if (decider.state.focus.areaId === command.areaId) {
    decider.emit({ type: 'focus.changed', focus: { areaId: null, until: null } });
    decider.run({ kind: 'briefing.request', areaId: null });
  }
  decider.emit({ type: 'area.removed', areaId: command.areaId });
}

export function changeFocus(decider: Decider, command: CommandOf<'focus.change'>) {
  assertArea(decider, command.areaId);
  const focus = { areaId: command.areaId, until: command.until };
  if (isSame(focus, decider.state.focus)) return;
  decider.emit({ type: 'focus.changed', focus });
  decider.run({ kind: 'briefing.request', areaId: command.areaId });
}

export function changeSettings(decider: Decider, command: CommandOf<'settings.change'>) {
  assertSettings(command.patch);
  const settings = { ...decider.state.settings, ...command.patch };
  if (isSame(settings, decider.state.settings)) return;
  decider.emit({ type: 'settings.changed', settings });
}

export function writeBriefing(decider: Decider, command: CommandOf<'briefing.write'>) {
  decider.emit({
    type: 'briefing.written',
    areaId: command.areaId,
    text: command.text,
    ...(command.briefing ? { briefing: command.briefing } : {}),
  });
}
