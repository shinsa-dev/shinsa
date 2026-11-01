import type {
  OnboardingChoiceGroup,
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
  ['projects', 'Projects'],
  ['defaults', 'Defaults'],
  ['accounts', 'Claude'],
  ['prerequisites', 'Tools'],
];

export function createOption(overrides: Partial<OnboardingOption> = {}): OnboardingOption {
  return { value: 'squash', label: 'Squash', detail: null, chosen: false, recommended: false, ...overrides };
}

function createDefaultGroups(): OnboardingChoiceGroup[] {
  return [
    {
      id: 'merge',
      label: 'Merging',
      options: [
        createOption({
          value: 'merge=squash',
          detail: 'Every pull request lands as one commit.',
          chosen: true,
          recommended: true,
        }),
        createOption({ value: 'merge=rebase', label: 'Rebase', detail: 'No merge commit.' }),
      ],
    },
    {
      id: 'plans',
      label: 'Plans',
      options: [
        createOption({ value: 'plans=large', label: 'Show me large plans first', chosen: true }),
        createOption({ value: 'plans=always', label: 'Show me every plan first' }),
        createOption({ value: 'plans=when_asked', label: 'Start building' }),
      ],
    },
  ];
}

export function createStep(overrides: Partial<OnboardingStep> = {}): OnboardingStep {
  return {
    id: 'defaults',
    title: 'How should agents work?',
    description: 'The recommended choices are picked.',
    multiple: false,
    options: [],
    groups: overrides.id === undefined || overrides.id === 'defaults' ? createDefaultGroups() : [],
    projects: [],
    filed: [],
    conversation: [],
    access: [],
    checks: [],
    ready: true,
    problem: null,
    help: null,
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
    welcome: null,
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
