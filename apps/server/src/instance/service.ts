type Env = Record<string, string | undefined>;

export const SERVICE_MARKER = 'SHINSA_SERVICE';

export function isStartedByService(env: Env) {
  return env[SERVICE_MARKER] === '1';
}
