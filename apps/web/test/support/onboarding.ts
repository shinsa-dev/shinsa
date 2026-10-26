import type {
  OnboardingFlow,
  OnboardingOption,
  OnboardingStatus,
  OnboardingStep,
  OnboardingStepId,
  RootSuggestions,
} from '@shinsa/core';

const USER_HOME = '/Users/me';

interface OnboardingRequest {
  path: string;
  method: string;
  body: unknown;
}

type Answer = unknown | ((body: unknown) => unknown);

interface FakeRoute {
  status?: number;
  answer: Answer;
}

const realFetch = globalThis.fetch;

export function createOnboardingStatus(overrides: Partial<OnboardingStatus['roots']> = {}, completed = true) {
  return {
    completed,
    completedAt: completed ? 1 : null,
    roots: { source: 'configured', configured: [], fromEnvironment: [], effective: [], ...overrides },
    defaults: { model: 'opus', mergeMethod: 'squash' },
    paths: {
      home: '/h/.config/shinsa',
      configPath: '/h/config.json',
      dataDir: '/h/data',
      userHome: USER_HOME,
    },
  } satisfies OnboardingStatus;
}

export function createSuggestions(paths: [string, number][]): RootSuggestions {
  return {
    suggestions: paths.map(([path, repoCount]) => ({ path, repoCount, repos: [], chosen: false })),
    truncated: false,
  };
}

const STEP_LABELS: [OnboardingStepId, string][] = [
  ['roots', 'Folders'],
  ['model', 'Model'],
  ['merge', 'Merging'],
  ['plans', 'Plans'],
  ['accounts', 'Accounts'],
  ['prerequisites', 'Tools'],
];

export function createOption(overrides: Partial<OnboardingOption> = {}): OnboardingOption {
  return { value: 'squash', label: 'Squash', detail: null, chosen: false, recommended: false, ...overrides };
}

export function createStep(overrides: Partial<OnboardingStep> = {}): OnboardingStep {
  return {
    id: 'merge',
    title: 'How should pull requests be merged?',
    description: 'Shinsa merges a pull request only after you approve the merge.',
    multiple: false,
    options: [
      createOption({ detail: 'Every pull request lands as one commit.', recommended: true }),
      createOption({ value: 'rebase', label: 'Rebase', detail: 'No merge commit.' }),
    ],
    checks: [],
    ready: true,
    imported: [],
    notes: [],
    problem: null,
    submitLabel: 'Continue',
    ...overrides,
  };
}

export function createFlow(
  step: OnboardingStep | null,
  overrides: Partial<OnboardingFlow> = {}
): OnboardingFlow {
  const index = step ? STEP_LABELS.findIndex(([id]) => id === step.id) : STEP_LABELS.length;
  return {
    steps: STEP_LABELS.map(([id, label], position) => ({
      id,
      label,
      summary: position < index ? `${label} answer` : null,
      reached: position <= index,
    })),
    index,
    step,
    revisit: false,
    ...overrides,
  };
}

export function startFakeOnboarding(routes: Record<string, FakeRoute>) {
  const requests: OnboardingRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ path, method, body });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response('not found', { status: 404 });
    const answer = typeof route.answer === 'function' ? route.answer(body) : route.answer;
    if (answer instanceof Promise) return Response.json(await answer, { status: route.status ?? 200 });
    return Response.json(answer, { status: route.status ?? 200 });
  }) as typeof fetch;
  return {
    requests,
    stop() {
      globalThis.fetch = realFetch;
    },
  };
}
