import {
  type Coverage,
  type CoverageFile,
  type CoverageFormat,
  type CoverageMode,
  type CoverageRange,
  type CoverageSetting,
  describeCoverage,
  formatCoveragePercent,
  type MeasuredCoverage,
  type Repo,
  resolveCoverageFormat,
  resolveRepoCoverage,
  selectMeasuredCoverage,
} from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { CoverageDetectionMap } from '@/lib/connection/coverage.ts';
import { formatCount } from '@/lib/format/count.ts';

export const COVERAGE_TITLE = 'Test coverage';

export interface CoverageItem {
  value: CoverageMode;
  label: string;
  hint: string;
  icon: MenuItemIcon;
}

const MODE_COPY: Record<CoverageMode, Omit<CoverageItem, 'value'>> = {
  auto: { label: 'Auto coverage', hint: '', icon: 'IconSparkle' },
  custom: {
    label: 'Custom coverage',
    hint: 'Runs your command and reads the report it writes.',
    icon: 'IconConsole',
  },
  off: { label: 'Coverage off', hint: 'Nothing is measured.', icon: 'IconEyeSlash' },
};

export function describeAutoCoverage(repo: Pick<Repo, 'id'>, detected: CoverageDetectionMap | null) {
  if (!detected) return 'Looking for a coverage tool in this repository.';
  const found = detected[repo.id];
  if (!found) return 'Found no coverage tool here, so nothing is measured.';
  return `Measures with ${found.tool}.`;
}

export function listCoverageItems(repo: Repo, detected: CoverageDetectionMap | null): CoverageItem[] {
  return (['auto', 'custom', 'off'] as const).map((mode) => ({
    value: mode,
    ...MODE_COPY[mode],
    ...(mode === 'auto' ? { hint: describeAutoCoverage(repo, detected) } : {}),
  }));
}

const CHANGED: Record<Exclude<CoverageMode, 'off'>, string> = {
  auto: 'with the tool Shinsa finds',
  custom: 'with your command',
};

export function describeCoverageChange(repo: Pick<Repo, 'name'>, setting: CoverageSetting) {
  if (setting.mode === 'off') return `Shinsa no longer measures test coverage in ${repo.name}.`;
  return `The next checks in ${repo.name} measure test coverage ${CHANGED[setting.mode]}.`;
}

export function changeCoverage(repo: Repo, setting: CoverageSetting) {
  if (JSON.stringify(resolveRepoCoverage(repo)) === JSON.stringify(setting)) return Promise.resolve(true);
  return sendCommandWithToast(
    { type: 'repo.update', repoId: repo.id, patch: { coverage: setting } },
    describeCoverageChange(repo, setting)
  );
}

export type CoverageFormatChoice = CoverageFormat | 'infer';

export interface CoverageDraft {
  command: string;
  report: string;
  format: CoverageFormatChoice;
}

export type CoverageDraftField = keyof CoverageDraft;

const COVERAGE_FORMAT_LABEL: Record<CoverageFormat, string> = {
  lcov: 'LCOV',
  cobertura: 'Cobertura XML',
  go: 'Go cover profile',
};

export const COVERAGE_DIALOG = {
  title: 'Custom test coverage',
  description:
    'After the checks, Shinsa runs this command in the task’s worktree, reads the report it writes and measures which changed lines the tests run.',
  action: 'Save',
  fields: {
    command: { label: 'Command', placeholder: 'npm test -- --coverage' },
    report: {
      label: 'Report',
      placeholder: 'coverage/lcov.info',
      hint: 'The path the command writes, inside the repository.',
    },
    format: { label: 'Format' },
  },
} as const;

export function createCoverageDraft(repo: Pick<Repo, 'coverage'>): CoverageDraft {
  const setting = resolveRepoCoverage(repo);
  if (setting.mode !== 'custom') return { command: '', report: '', format: 'infer' };
  return { command: setting.command, report: setting.report, format: setting.format ?? 'infer' };
}

export function describeInferredFormat(report: string) {
  const format = resolveCoverageFormat(report);
  if (!report.trim()) return 'Infer from the path';
  return format ? `Infer from the path: ${COVERAGE_FORMAT_LABEL[format]}` : 'Infer from the path: unknown';
}

export function listFormatChoices(report: string): { value: CoverageFormatChoice; label: string }[] {
  return [
    { value: 'infer', label: describeInferredFormat(report) },
    ...(['lcov', 'cobertura', 'go'] as const).map((format) => ({
      value: format,
      label: COVERAGE_FORMAT_LABEL[format],
    })),
  ];
}

function validateReport(report: string) {
  const path = report.trim();
  if (!path) return 'Give the path of the report the command writes.';
  const segments = path.replace(/\\/g, '/').split('/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || segments.includes('..')) {
    return 'Give a path inside the repository, such as coverage/lcov.info.';
  }
  return null;
}

export function validateCoverageDraft(draft: CoverageDraft) {
  const errors: Partial<Record<CoverageDraftField, string>> = {};
  if (!draft.command.trim()) errors.command = 'Give the command that writes the report.';
  const report = validateReport(draft.report);
  if (report) errors.report = report;
  else if (draft.format === 'infer' && !resolveCoverageFormat(draft.report)) {
    errors.format = 'Shinsa cannot tell the format from the path. Choose one.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function resolveDraftCoverage(draft: CoverageDraft): CoverageSetting {
  return {
    mode: 'custom',
    command: draft.command.trim(),
    report: draft.report.trim(),
    format: draft.format === 'infer' ? null : draft.format,
  };
}

export function countUncoveredFiles(coverage: Coverage | null | undefined) {
  return selectMeasuredCoverage(coverage)?.files.filter((file) => file.covered < file.executable).length ?? 0;
}

export function describeCoverageSummary(coverage: Coverage | null | undefined) {
  const summary = describeCoverage(coverage);
  if (!summary) return null;
  const files = countUncoveredFiles(coverage);
  return files > 0 ? `${summary} · ${formatCount(files, 'file has', 'files have')} uncovered lines` : summary;
}

export function describeCoverageFact(coverage: Coverage | null | undefined) {
  const measured = selectMeasuredCoverage(coverage);
  if (!measured) return null;
  if (measured.covered === measured.executable) return 'All changed lines covered';
  return `${formatCoveragePercent(measured.covered, measured.executable)} of changed lines covered`;
}

export function describeFileCoverage(file: Pick<CoverageFile, 'covered' | 'executable'>) {
  return `${file.covered} of ${formatCount(file.executable, 'line', 'lines')}`;
}

export function isFileCovered(file: Pick<CoverageFile, 'covered' | 'executable'>) {
  return file.covered === file.executable;
}

export function describeFilesToggle(coverage: Pick<MeasuredCoverage, 'files'>, open: boolean) {
  const files = formatCount(coverage.files.length, 'file', 'files');
  return open ? `Hide ${files}` : `Show ${files}`;
}

export function describeRangeLabel([start, end]: CoverageRange) {
  return start === end ? `${start}` : `${start}–${end}`;
}
