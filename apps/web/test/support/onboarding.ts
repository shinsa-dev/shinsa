import type {
  OnboardingChat,
  OnboardingMessage,
  OnboardingPrompt,
  OnboardingStatus,
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

let count = 0;

export function createMessage(overrides: Partial<OnboardingMessage> = {}): OnboardingMessage {
  count += 1;
  return { id: `m${count}`, from: 'shinsa', text: 'Hello.', problem: false, checks: [], ...overrides };
}

export function createPrompt(overrides: Partial<OnboardingPrompt> = {}): OnboardingPrompt {
  return {
    questionId: 'merge',
    step: 3,
    steps: 6,
    mode: 'answer',
    multiple: false,
    choices: [
      { value: 'squash', label: 'Squash', detail: null, chosen: true },
      { value: 'rebase', label: 'Rebase', detail: null, chosen: false },
    ],
    submitLabel: null,
    placeholder: 'Pick an option or answer in your own words',
    ...overrides,
  };
}

export function createChat(prompt: OnboardingPrompt | null, messages = [createMessage()]): OnboardingChat {
  return { messages, prompt };
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
