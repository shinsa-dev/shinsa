export const DRAFT_STORE_BEFORE = `import { db } from '@/lib/db';
import type { StoreForm } from './onboarding-form';

export async function createStore(form: StoreForm) {
  const store = await db.stores.insert({
    name: form.name.trim(),
    currency: form.currency,
    country: form.country,
    payments: form.payments,
    shipping: form.shipping,
  });
  return store.id;
}
`;

export const DRAFT_STORE_AFTER = `import { db } from '@/lib/db';
import type { StepAnswers, StepId } from './steps';
import { validateStep } from './steps';

export interface StoreDraft {
  id: string;
  ownerId: string;
  answers: Partial<StepAnswers>;
  finished: StepId[];
  updatedAt: number;
}

export async function selectDraft(ownerId: string) {
  return db.storeDrafts.findFirst({ where: { ownerId } });
}

export async function saveStep<S extends StepId>(ownerId: string, step: S, answers: StepAnswers[S]) {
  const problems = validateStep(step, answers);
  if (problems.length > 0) return { saved: false as const, problems };
  const draft = await selectDraft(ownerId);
  const finished = [...new Set([...(draft?.finished ?? []), step])];
  await db.storeDrafts.upsert({
    where: { ownerId },
    create: { ownerId, answers: { [step]: answers }, finished, updatedAt: Date.now() },
    update: { answers: { ...draft?.answers, [step]: answers }, finished, updatedAt: Date.now() },
  });
  return { saved: true as const, problems: [] };
}

export async function createStore(ownerId: string) {
  const draft = await selectDraft(ownerId);
  if (!draft || draft.finished.length < 3) throw new Error('The store has steps left to finish.');
  const { details, payments, shipping } = draft.answers as StepAnswers;
  const store = await db.stores.insert({ ...details, payments, shipping });
  await db.storeDrafts.delete({ where: { ownerId } });
  return store.id;
}
`;

export const STEPS_AFTER = `export type StepId = 'details' | 'payments' | 'shipping';

export interface StepAnswers {
  details: { name: string; currency: string; country: string };
  payments: { providers: string[] };
  shipping: { zones: string[]; freeOver: number | null };
}

export const STEPS: { id: StepId; title: string }[] = [
  { id: 'details', title: 'Store details' },
  { id: 'payments', title: 'Payments' },
  { id: 'shipping', title: 'Shipping' },
];

export function validateStep<S extends StepId>(step: S, answers: StepAnswers[S]) {
  const problems: string[] = [];
  if (step === 'details') {
    const details = answers as StepAnswers['details'];
    if (details.name.trim() === '') problems.push('Give the store a name.');
    if (details.currency === '') problems.push('Pick a currency.');
  }
  if (step === 'payments' && (answers as StepAnswers['payments']).providers.length === 0) {
    problems.push('Connect at least one payment provider.');
  }
  return problems;
}
`;

export const RESUME_AFTER = `import { selectDraft } from './draft-store';
import { STEPS, type StepId } from './steps';

export async function resolveResumeStep(ownerId: string): Promise<StepId> {
  const draft = await selectDraft(ownerId);
  if (!draft) return 'details';
  const next = STEPS.find((step) => !draft.finished.includes(step.id));
  return next?.id ?? 'shipping';
}
`;

export const PROGRESS_DOTS_AFTER = `import { STEPS, type StepId } from './steps';

export function ProgressDots({ current, onBack }: { current: StepId; onBack: () => void }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <div className="flex items-center gap-3">
      {index > 0 && (
        <button type="button" className="text-sm text-muted" onClick={onBack}>
          Back
        </button>
      )}
      <ol className="flex gap-1.5" aria-label={\`Step \${index + 1} of \${STEPS.length}\`}>
        {STEPS.map((step, position) => (
          <li key={step.id} className={position <= index ? 'dot dot-filled' : 'dot'} />
        ))}
      </ol>
    </div>
  );
}
`;

export const ROUTE_BEFORE = `import { OnboardingForm } from '@/onboarding/onboarding-form';
import { createStore } from '@/onboarding/draft-store';

export default function OnboardingRoute() {
  return <OnboardingForm onSubmit={(form) => createStore(form)} />;
}
`;

export const ROUTE_AFTER = `import { ProgressDots } from '@/onboarding/progress-dots';
import { resolveResumeStep } from '@/onboarding/resume';
import { StepForm } from '@/onboarding/step-form';
import { useOwner } from '@/lib/session';
import { useAsync } from '@/lib/use-async';

export default function OnboardingRoute() {
  const owner = useOwner();
  const step = useAsync(() => resolveResumeStep(owner.id), [owner.id]);
  if (!step.ready) return null;
  return (
    <main className="mx-auto max-w-md">
      <ProgressDots current={step.value} onBack={step.back} />
      <StepForm step={step.value} ownerId={owner.id} onSaved={step.reload} />
    </main>
  );
}
`;

export const DRAFT_TEST_AFTER = `import { describe, expect, test } from 'bun:test';
import { createStore, saveStep } from '@/onboarding/draft-store';
import { resolveResumeStep } from '@/onboarding/resume';

describe('store drafts', () => {
  test('a reload resumes on the first unfinished step', async () => {
    await saveStep('owner-1', 'details', { name: 'Fern & Co', currency: 'EUR', country: 'NL' });
    expect(await resolveResumeStep('owner-1')).toBe('payments');
  });

  test('an empty store name is not saved', async () => {
    const result = await saveStep('owner-2', 'details', { name: ' ', currency: 'EUR', country: 'NL' });
    expect(result.saved).toBe(false);
    expect(await resolveResumeStep('owner-2')).toBe('details');
  });

  test('a store is only created once every step is finished', async () => {
    await saveStep('owner-3', 'details', { name: 'Fern & Co', currency: 'EUR', country: 'NL' });
    await expect(createStore('owner-3')).rejects.toThrow('steps left');
  });
});
`;

export const UNCHANGED_FILES: Record<string, string> = {
  'package.json': `{
  "name": "northwind-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "lint": "biome check .",
    "check-types": "tsc --noEmit",
    "test": "bun test"
  }
}
`,
  'README.md': `# Northwind web

The storefront and the merchant dashboard. \`bun dev\` runs it on :5173.
`,
  'src/lib/db.ts': `import { createClient } from './db-client';

export const db = createClient(process.env.DATABASE_URL);
`,
  'src/lib/session.ts': `import { useContext } from 'react';
import { SessionContext } from './session-context';

export function useOwner() {
  return useContext(SessionContext).owner;
}
`,
  'src/onboarding/step-form.tsx': `import { saveStep } from './draft-store';
import type { StepId } from './steps';

export function StepForm({ step, ownerId, onSaved }: { step: StepId; ownerId: string; onSaved: () => void }) {
  return <form data-step={step} onSubmit={() => saveStep(ownerId, step, {} as never).then(onSaved)} />;
}
`,
};
