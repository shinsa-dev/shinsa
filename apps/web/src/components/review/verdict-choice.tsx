import { type FindingVerdictKind, listOpenGates, type ShinsaState, type Task } from '@shinsa/core';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { resolveVerdict, resolveVerdictDraft, VERDICT_ITEMS } from '@/lib/overview/verdicts.ts';

export function hasOpenReviewGate(state: ShinsaState, taskId: string) {
  return listOpenGates(state, taskId).some((gate) => gate.type === 'review');
}

export function VerdictChoice({
  value,
  onValueChange,
}: {
  value: FindingVerdictKind;
  onValueChange: (verdict: FindingVerdictKind) => void;
}) {
  return <Choice label='Verdict' items={VERDICT_ITEMS} value={value} onValueChange={onValueChange} />;
}

export function FindingVerdictChoice({ task, finding }: { task: Task; finding: number | null }) {
  const draft = useReviewDraft();
  const selectOpen = React.useCallback((state: ShinsaState) => hasOpenReviewGate(state, task.id), [task.id]);
  const reviewing = useShinsaSelector(selectOpen);
  if (finding === null || !reviewing) return null;
  const verdicts = resolveVerdictDraft(task.findings, draft.verdicts);
  return (
    <VerdictChoice
      value={resolveVerdict(verdicts, finding)}
      onValueChange={(verdict) => draft.setVerdict(finding, verdict)}
    />
  );
}
