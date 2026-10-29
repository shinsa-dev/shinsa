import { HOUR_MS, MINUTE_MS, type Repo, type RepoCi } from '@shinsa/core';
import { runCommand } from '../shell/index.ts';
import { GITHUB_TIMEOUT_MS, resolveRepoSlug } from './index.ts';

interface RepoSlug {
  owner: string;
  name: string;
}

interface WorkflowEntry {
  name: string;
  object: { text?: string | null } | null;
}

interface CiDetails {
  repository: {
    workflows: { entries?: WorkflowEntry[] } | null;
    base: { statusCheckRollup?: { state: string } | null } | null;
  } | null;
}

interface RequiredCheckRule {
  type?: string;
  parameters?: { required_status_checks?: unknown[] };
}

interface BranchView {
  protection?: { required_status_checks?: { contexts?: unknown[]; checks?: unknown[] } | null };
}

const CI_QUERY = `query($owner:String!,$name:String!,$workflows:String!,$base:String!){repository(owner:$owner,name:$name){workflows:object(expression:$workflows){... on Tree{entries{name object{... on Blob{text}}}}} base:object(expression:$base){... on Commit{statusCheckRollup{state}}}}}`;

const CHECK_TRIGGERS = new Set(['push', 'pull_request', 'pull_request_target']);

const WORKFLOW_FILE = /\.ya?ml$/;

const KNOWN_CI_MS = HOUR_MS;

const UNKNOWN_CI_MS = 5 * MINUTE_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listTriggerNames(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.filter((name): name is string => typeof name === 'string');
  return isRecord(on) ? Object.keys(on) : [];
}

export function isCheckWorkflow(text: string) {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch {
    return true;
  }
  if (!isRecord(parsed)) return true;
  return listTriggerNames(parsed.on).some((name) => CHECK_TRIGGERS.has(name));
}

async function runGhJson(args: string[], repo: Repo, signal?: AbortSignal): Promise<unknown> {
  const result = await runCommand(['gh', ...args], repo.path, { signal, timeoutMs: GITHUB_TIMEOUT_MS });
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
}

async function readCheckSources(repo: Repo, slug: RepoSlug, base: string, signal?: AbortSignal) {
  const output = await runGhJson(
    [
      'api',
      'graphql',
      '-f',
      `query=${CI_QUERY}`,
      '-f',
      `owner=${slug.owner}`,
      '-f',
      `name=${slug.name}`,
      '-f',
      `workflows=${base}:.github/workflows`,
      '-f',
      `base=${base}`,
      '--jq',
      '.data',
    ],
    repo,
    signal
  );
  const repository = isRecord(output) ? (output as unknown as CiDetails).repository : null;
  if (!repository) return null;
  const workflows = (repository.workflows?.entries ?? []).filter((entry) => WORKFLOW_FILE.test(entry.name));
  if (workflows.some((entry) => isCheckWorkflow(entry.object?.text ?? ''))) return true;
  return Boolean(repository.base?.statusCheckRollup);
}

function countRuleChecks(rules: unknown) {
  if (!Array.isArray(rules)) return null;
  return (rules as RequiredCheckRule[])
    .filter((rule) => rule.type === 'required_status_checks')
    .reduce((count, rule) => count + (rule.parameters?.required_status_checks?.length ?? 0), 0);
}

function countProtectionChecks(branch: unknown) {
  if (!isRecord(branch)) return null;
  const required = (branch as BranchView).protection?.required_status_checks;
  return Math.max(required?.contexts?.length ?? 0, required?.checks?.length ?? 0);
}

async function countRequiredChecks(repo: Repo, slug: RepoSlug, base: string, signal?: AbortSignal) {
  const path = `repos/${slug.owner}/${slug.name}`;
  const branch = encodeURIComponent(base);
  const [protection, rules] = await Promise.all([
    runGhJson(['api', `${path}/branches/${branch}`], repo, signal).then(countProtectionChecks),
    runGhJson(['api', `${path}/rules/branches/${branch}`], repo, signal).then(countRuleChecks),
  ]);
  if (protection === null || rules === null) return null;
  return protection + rules;
}

export async function readRepoCi(repo: Repo, base: string, signal?: AbortSignal): Promise<RepoCi> {
  const slug = resolveRepoSlug(repo);
  if (!slug) return 'unknown';
  const [required, sources] = await Promise.all([
    countRequiredChecks(repo, slug, base, signal),
    readCheckSources(repo, slug, base, signal),
  ]);
  if (required !== null && required > 0) return 'required';
  if (sources === true) return 'workflows';
  if (required === null || sources === null) return 'unknown';
  return 'none';
}

export class RepoCiCache {
  readonly #entries = new Map<string, { ci: RepoCi; until: number }>();

  async resolve(repo: Repo, base: string, signal?: AbortSignal) {
    const key = `${repo.id}\n${base}`;
    const cached = this.#entries.get(key);
    if (cached && cached.until > Date.now()) return cached.ci;
    const ci = await readRepoCi(repo, base, signal);
    if (signal?.aborted) return ci;
    this.#entries.set(key, { ci, until: Date.now() + (ci === 'unknown' ? UNKNOWN_CI_MS : KNOWN_CI_MS) });
    return ci;
  }
}
