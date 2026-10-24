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
    patch: chunk,
    ...resolveRisk(path),
  };
}

const RISK_ORDER: Record<DiffFile['risk'], number> = { high: 0, normal: 1, low: 2 };

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files = text
    .split(/^(?=diff --git )/m)
    .map((chunk) => parseFile(chunk))
    .filter((file): file is DiffFile => file !== null);
  return files.sort(
    (a, b) =>
      RISK_ORDER[a.risk] - RISK_ORDER[b.risk] ||
      b.additions + b.deletions - (a.additions + a.deletions) ||
      a.path.localeCompare(b.path)
  );
}
