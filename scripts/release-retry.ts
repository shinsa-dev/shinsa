export const NOTARY_SUBMIT_DELAYS = [30_000, 60_000] as const;

export const STAPLE_DELAYS = [15_000, 30_000, 60_000, 120_000] as const;

const NOTARY_SECRETS = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] as const;

export interface RetryFailure {
  label: string;
  attempt: number;
  attempts: number;
  delay: number;
  error: unknown;
}

export interface RetryOptions {
  label: string;
  delays: readonly number[];
  sleep: (milliseconds: number) => Promise<void>;
  onRetry: (failure: RetryFailure) => void;
}

export interface NotaryCredentials {
  appleId: string;
  password: string;
  teamId: string;
}

export interface NotarySubmission {
  id: string;
  status: string;
}

export async function retryStep<T>(step: (attempt: number) => Promise<T>, options: RetryOptions) {
  const attempts = options.delays.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await step(attempt);
    } catch (error) {
      const delay = options.delays[attempt - 1];
      if (delay === undefined) throw error;
      options.onRetry({ label: options.label, attempt, attempts, delay, error });
      await options.sleep(delay);
    }
  }
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const stderr = (error as Error & { stderr?: unknown }).stderr;
  const detail = stderr === undefined ? '' : String(stderr).trim();
  return detail ? `${error.message}: ${detail}` : error.message;
}

export function describeRetryFailure(failure: RetryFailure) {
  const seconds = Math.round(failure.delay / 1000);
  return `${failure.label} failed on attempt ${failure.attempt} of ${failure.attempts} (${describeError(failure.error)}). Trying again in ${seconds}s.`;
}

export function resolveNotaryCredentials(
  env: Readonly<Record<string, string | undefined>>
): NotaryCredentials {
  const missing = NOTARY_SECRETS.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Set ${missing.join(', ')} to notarize the app (docs/release.md).`);
  return {
    appleId: env.APPLE_ID as string,
    password: env.APPLE_APP_SPECIFIC_PASSWORD as string,
    teamId: env.APPLE_TEAM_ID as string,
  };
}

export function parseNotarySubmission(output: string): NotarySubmission {
  const parsed: unknown = JSON.parse(output);
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('notarytool did not answer with an object.');
  const { id, status } = parsed as Record<string, unknown>;
  if (typeof id !== 'string' || typeof status !== 'string') {
    throw new Error(`notarytool did not return a submission id and status: ${output.trim()}`);
  }
  return { id, status };
}

export function describeNotaryRejection(submission: NotarySubmission, log: string) {
  return `Apple did not accept submission ${submission.id}: its status is ${submission.status}.\n${log.trim()}`;
}
