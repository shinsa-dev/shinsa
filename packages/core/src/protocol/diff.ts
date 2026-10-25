import type { DiffFile } from './messages.ts';

const HIGH_RISK: [RegExp, string][] = [
  [/(^|\/)(auth|session|permission|security|crypto)/i, 'Touches auth or security'],
  [/(migration|schema|\.sql$)/i, 'Changes the data model'],
  [/(billing|payment|price|purchase|subscription|checkout)/i, 'Touches money'],
  [/(^|\/)(api|routes?|server|handlers?)\//i, 'Changes a server surface'],
  [/(\.github\/workflows|wrangler|Dockerfile|infra\/)/i, 'Changes deploy or CI'],
  [/(package\.json$|\.env)/i, 'Changes dependencies or configuration'],
];

const LOW_RISK: RegExp[] = [
  /(^|\/)(test|tests|__tests__|fixtures)\//i,
  /\.(test|plan)\.[jt]sx?$/i,
  /\.(md|mdx|txt)$/i,
  /(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  /\.snap$/,
];

function resolveRisk(path: string): Pick<DiffFile, 'risk' | 'riskReason'> {
  for (const [pattern, reason] of HIGH_RISK) {
    if (pattern.test(path)) return { risk: 'high', riskReason: reason };
  }
  if (LOW_RISK.some((pattern) => pattern.test(path))) return { risk: 'low', riskReason: null };
  return { risk: 'normal', riskReason: null };
}

function resolveStatus(header: string): DiffFile['status'] {
  if (/^new file mode/m.test(header)) return 'added';
  if (/^deleted file mode/m.test(header)) return 'removed';
  if (/^rename from/m.test(header)) return 'renamed';
  return 'modified';
}

function countChanges(chunk: string) {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of chunk.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function parseFile(chunk: string): DiffFile | null {
  const pathMatch = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
  if (!pathMatch) return null;
  const previous = pathMatch[1] ?? '';
  const path = pathMatch[2] ?? previous;
  const { additions, deletions } = countChanges(chunk);
  const status = resolveStatus(chunk);
  return {
    path,
    previousPath: status === 'renamed' ? previous : null,
    status,
    additions,
    deletions,
    binary: /^Binary files .* differ$/m.test(chunk) || /^GIT binary patch$/m.test(chunk),
    patch: chunk,
    ...resolveRisk(path),
  };
}

const RISK_ORDER: Record<DiffFile['risk'], number> = { high: 0, normal: 1, low: 2 };

function sortDiffFiles(files: DiffFile[]) {
  return files.sort(
    (a, b) =>
      RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
      b.additions + b.deletions - (a.additions + a.deletions) ||
      a.path.localeCompare(b.path)
  );
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  return sortDiffFiles(
    text
      .split(/^(?=diff --git )/m)
      .map((chunk) => parseFile(chunk))
      .filter((file): file is DiffFile => file !== null)
  );
}

export const DIFF_PATCH_LIMITS = {
  fileLines: 2_000,
  totalLines: 20_000,
  files: 400,
  fileBytes: 256 * 1024,
  totalBytes: 1024 * 1024,
} as const;

const RAW_STATUS: Record<string, DiffFile['status']> = { A: 'added', D: 'removed', R: 'renamed', C: 'added' };

interface RawRecord {
  status: DiffFile['status'];
  path: string;
  previousPath: string | null;
}

function readRawRecords(fields: string[]) {
  const records: RawRecord[] = [];
  let index = 0;
  while (fields[index]?.startsWith(':')) {
    const code = (fields[index] ?? '').split(' ').at(-1)?.charAt(0) ?? 'M';
    const status = RAW_STATUS[code] ?? 'modified';
    const twoPaths = code === 'R' || code === 'C';
    const first = fields[index + 1] ?? '';
    const second = twoPaths ? (fields[index + 2] ?? '') : first;
    records.push({ status, path: second, previousPath: code === 'R' ? first : null });
    index += twoPaths ? 3 : 2;
  }
  return { records, rest: fields.slice(index) };
}

function readCounts(fields: string[]) {
  const counts: { additions: number; deletions: number; binary: boolean }[] = [];
  let index = 0;
  while (index < fields.length) {
    const [added = '', deleted = '', path = ''] = (fields[index] ?? '').split('\t');
    counts.push({ additions: Number(added) || 0, deletions: Number(deleted) || 0, binary: added === '-' });
    index += path === '' ? 3 : 1;
  }
  return counts;
}

export function parseDiffSummary(text: string): DiffFile[] {
  const fields = text.split('\0');
  const { records, rest } = readRawRecords(fields);
  const counts = readCounts(rest.filter((field, index) => field !== '' || index < rest.length - 1));
  return sortDiffFiles(
    records.map((record, index) => ({
      ...record,
      additions: counts[index]?.additions ?? 0,
      deletions: counts[index]?.deletions ?? 0,
      binary: counts[index]?.binary ?? false,
      patch: '',
      patchOmitted: true,
      ...resolveRisk(record.path),
    }))
  );
}

export function selectPatchedFiles(files: readonly DiffFile[]) {
  const chosen: DiffFile[] = [];
  let lines = 0;
  for (const file of files) {
    const size = file.additions + file.deletions;
    if (file.binary || size > DIFF_PATCH_LIMITS.fileLines) continue;
    if (lines + size > DIFF_PATCH_LIMITS.totalLines || chosen.length >= DIFF_PATCH_LIMITS.files) break;
    chosen.push(file);
    lines += size;
  }
  return chosen;
}

export function mergeDiffPatches(
  summary: readonly DiffFile[],
  patched: readonly DiffFile[],
  limits: { fileBytes: number; totalBytes: number } = DIFF_PATCH_LIMITS
): DiffFile[] {
  const byPath = new Map(patched.map((file) => [file.path, file]));
  let bytes = 0;
  return summary.map((file) => {
    if (file.binary) return { ...file, patchOmitted: false };
    const found = byPath.get(file.path);
    const size = found?.patch.length ?? 0;
    if (!found || size > limits.fileBytes || bytes + size > limits.totalBytes) return file;
    bytes += size;
    return { ...file, patch: found.patch, patchOmitted: false };
  });
}
