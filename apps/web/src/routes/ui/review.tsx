import type { WorkReport } from '@shinsa/core';
import { ReviewNote } from '@/components/review/note.tsx';
import { listAttentionItems, toCommentItem } from '@/lib/review/report.ts';
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
          why: 'Keys stay `section:spot`, so links into Code keep working.',
        },
      ],
    },
  ],
  checks: [],
  judgementCalls: [
    {
      call: 'Kept the old keys',
      reason: 'Links already shared in SW-142 still open the right place.',
      file: SAMPLE_CODE_PATH,
      line: 7,
    },
  ],
};

const ITEMS = listAttentionItems(REPORT, SAMPLE_CODE_FINDINGS);

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

export function ReviewSpecimens() {
  return (
    <>
      <Specimen label='Needs your attention · ReviewNote: a blocking finding, a spot to read carefully, a suggestion, a judgement call; author, tone, title, markdown and the suggested fix (the snippet shows on a task page)'>
        <div className='flex w-full max-w-2xl flex-col gap-2'>
          {ITEMS.map((item, index) => (
            <ReviewNote key={item.key} item={item} selected={index === 0} />
          ))}
        </div>
      </Specimen>
      <Specimen label='Your comment · the same card, with Remove'>
        <div className='flex w-full max-w-2xl flex-col gap-2'>
          {SAMPLE_CODE_COMMENTS.map((comment) => (
            <ReviewNote key={comment.id} item={toCommentItem(comment)} action={<Remove />} />
          ))}
        </div>
      </Specimen>
      <Specimen label='Inline in the Code tab · compact: no snippet and no place, the line above is the place'>
        <div className='flex w-full max-w-xl flex-col gap-2'>
          {ITEMS.slice(0, 1).map((item) => (
            <ReviewNote key={item.key} item={item} compact />
          ))}
        </div>
      </Specimen>
    </>
  );
}
