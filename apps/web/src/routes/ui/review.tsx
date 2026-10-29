import type { FindingVerdictKind, WorkReport } from '@shinsa/core';
import * as React from 'react';
import { ReviewNote } from '@/components/review/note.tsx';
import { VerdictChoice } from '@/components/review/verdict-choice.tsx';
import { createVerdictDraft, resolveVerdict } from '@/lib/overview/verdicts.ts';
import { createDisclosureId, notPersisted } from '@/lib/preferences/disclosure.ts';
import {
  isFindingItem,
  listReviewChapters,
  listReviewPoints,
  type ReviewItem,
  toCommentItem,
} from '@/lib/review/report.ts';
import { SAMPLE_CODE_COMMENTS, SAMPLE_CODE_FINDINGS, SAMPLE_CODE_PATH } from './sample-code.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const REPORT: WorkReport = {
  headline: 'The walkthrough reads every spot from the report.',
  sections: [
    {
      title: 'Read the spots',
      summary: 'Every phase hands over its spots.',
      spots: [
        {
          file: 'apps/web/src/lib/review/targets.ts',
          start: 12,
          end: 18,
          attention: 'high',
          title: 'The spot key',
          explain: 'Each spot is keyed by its section and its place in it, so a link names one card.',
          why: 'Keys stay `section:spot`, so links into Code keep working.',
        },
      ],
    },
  ],
  checks: [],
  judgementCalls: [
    {
      title: 'Keep the old spot keys',
      call: 'Kept the old keys',
      reason: 'Links already shared in SW-142 still open the right place.',
      file: SAMPLE_CODE_PATH,
      line: 7,
      alternatives: [{ option: 'New keys', rejected: 'Every shared link would open nothing.' }],
    },
  ],
};

const ITEMS = listReviewPoints(
  listReviewChapters(REPORT, SAMPLE_CODE_FINDINGS, [
    { call: 'Kept the old keys', reason: 'A key per finding would make the links clearer.' },
  ])
);

const POINTS = ITEMS.filter((item) => !isFindingItem(item));

const FINDINGS = ITEMS.filter(isFindingItem);

function Remove() {
  return (
    <button
      type='button'
      className='cursor-pointer text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
      onClick={() => void acknowledgeSample()}
    >
      Remove
    </button>
  );
}

function SampleVerdict({ item }: { item: ReviewItem }) {
  const [verdict, setVerdict] = React.useState<FindingVerdictKind>(() =>
    resolveVerdict(createVerdictDraft(SAMPLE_CODE_FINDINGS), item.finding ?? -1)
  );
  return <VerdictChoice value={verdict} onValueChange={setVerdict} />;
}

export function ReviewSpecimens() {
  return (
    <>
      <Specimen label='A review point · ReviewNote with its header bar: key code with its explanation and why it matters, a disputed judgement call with its alternative; its title (no author: every point is the agent’s), tone and section in the bar, which folds the card, then the call, markdown and the snippet on a task page'>
        <div className='flex w-full max-w-2xl flex-col gap-2'>
          {POINTS.map((item, index) => (
            <ReviewNote
              key={item.key}
              persistId={createDisclosureId('ui', 'review', 'point', item.key)}
              item={item}
              selected={index === 0}
            />
          ))}
        </div>
      </Specimen>
      <Specimen label='A finding · FindingNote, no bar: a blocking, a should fix and an optional finding, the level over the issue on the left, Fix / Dismiss on the right, the proposed fix below'>
        <div className='flex w-full max-w-2xl flex-col gap-2'>
          {FINDINGS.map((item) => (
            <ReviewNote
              key={item.key}
              persistId={notPersisted('a finding card never folds')}
              item={item}
              action={<SampleVerdict item={item} />}
            />
          ))}
        </div>
      </Specimen>
      <Specimen label='Your comment · headed You, the one author a review point names, with Remove in its header bar'>
        <div className='flex w-full max-w-2xl flex-col gap-2'>
          {SAMPLE_CODE_COMMENTS.map((comment) => (
            <ReviewNote
              key={comment.id}
              persistId={createDisclosureId('ui', 'review', 'comment', comment.id)}
              item={toCommentItem(comment)}
              action={<Remove />}
            />
          ))}
        </div>
      </Specimen>
      <Specimen label='Inline in the Code tab · compact: no snippet and no place, the line above is the place; a finding of each level and your comment'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          {FINDINGS.map((item) => (
            <ReviewNote
              key={item.key}
              persistId={notPersisted('a finding card never folds')}
              item={item}
              compact
              action={<SampleVerdict item={item} />}
            />
          ))}
          {SAMPLE_CODE_COMMENTS.slice(0, 1).map((comment) => (
            <ReviewNote
              key={comment.id}
              persistId={createDisclosureId('ui', 'review', 'inline-comment', comment.id)}
              item={toCommentItem(comment)}
              compact
              action={<Remove />}
            />
          ))}
        </div>
      </Specimen>
    </>
  );
}
