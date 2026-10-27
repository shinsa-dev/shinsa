import type { ChecklistItem } from '@shinsa/core';
import {
  Checklist,
  ChecklistDetail,
  ChecklistMark,
  ChecklistItem as ChecklistRow,
  ChecklistTitle,
} from '@shinsa/ui/components/checklist';
import * as React from 'react';
import { ChecklistBlock, ItemChecklist } from '@/components/controls/checklist.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { Section, Specimen } from './section.tsx';

export const CHECKLIST_SECTIONS = [{ id: 'checklist', label: 'Checklist' }];

const RELEASE_ITEMS: ChecklistItem[] = [
  {
    key: 'tag',
    title: 'Tag the release',
    detail: 'From `main`, after CI is green.',
    command: 'git tag v1.4.0 && git push --tags',
    done: true,
  },
  {
    key: 'notes',
    title: 'Publish the release notes',
    detail: 'Paste the changelog into the GitHub release.',
    command: null,
    done: false,
  },
  {
    key: 'announce',
    title: 'Announce it in **#releases**',
    detail: null,
    command: null,
    done: false,
  },
];

const DEPLOY_ITEMS: ChecklistItem[] = [
  {
    key: 'migrate',
    title: 'Run the migration',
    detail: 'Adds the `invoices` table.',
    command: 'bun run db:migrate',
    done: false,
  },
  {
    key: 'flag',
    title: 'Turn on the invoices flag',
    detail: 'Once the migration ran in production.',
    command: null,
    done: false,
  },
];

const TASK_LIST_SAMPLE = `Before the release:

- [x] Update the changelog
- [x] Bump the version in \`package.json\`
- [ ] Check the upgrade notes
  - read the migration section
  - try it on a copy of the database
- [ ] Ship it`;

function useTicks(initial: ChecklistItem[]) {
  const [items, setItems] = React.useState(initial);
  const tick = (item: ChecklistItem, done: boolean) => {
    setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, done } : entry)));
  };
  return { items, tick };
}

function Interactive() {
  const { items, tick } = useTicks(RELEASE_ITEMS);
  return <ChecklistBlock title='Release' items={items} onTick={tick} />;
}

function WithCommands() {
  const { items, tick } = useTicks(DEPLOY_ITEMS);
  const migrated = items[0]?.done === true;
  return (
    <ChecklistBlock
      title='Post-merge'
      items={items}
      onTick={tick}
      describeBlock={(item) => (item.key === 'flag' && !migrated ? 'Tick it once the migration ran' : null)}
    />
  );
}

export function ChecklistSpecimens() {
  return (
    <Section
      id='checklist'
      title='Checklist'
      description='Things to do, one row each: a check, the title, an optional detail and command, and what the row offers under them. Checklist and its rows are the kit’s; ChecklistBlock and ItemChecklist (components/controls) draw a list of ChecklistItem from @shinsa/core with Markdown, the code block and the tick. A Markdown task list renders the same rows, read-only.'
      className='flex-col items-start gap-6'
    >
      <Specimen label='ChecklistBlock · tick in place; the header counts what is done'>
        <div className='w-full max-w-xl'>
          <Interactive />
        </div>
      </Specimen>
      <Specimen label='With commands · a row’s command is a code block with Copy and Run in terminal in its corner; a row that cannot be ticked yet is disabled, its tooltip saying why'>
        <div className='w-full max-w-xl'>
          <WithCommands />
        </div>
      </Specimen>
      <Specimen label='ItemChecklist without onTick · read-only marks'>
        <div className='w-full max-w-xl'>
          <ItemChecklist items={RELEASE_ITEMS} />
        </div>
      </Specimen>
      <Specimen label='Kit parts · Checklist, ChecklistItem, ChecklistMark, ChecklistTitle with meta, ChecklistDetail'>
        <Checklist className='w-full max-w-xl'>
          <ChecklistRow done check={<ChecklistMark done />}>
            <ChecklistTitle meta='Config'>Set the region</ChecklistTitle>
            <ChecklistDetail>eu-west-1 for every service.</ChecklistDetail>
          </ChecklistRow>
          <ChecklistRow done={false} check={<ChecklistMark done={false} />}>
            <ChecklistTitle>Rotate the key</ChecklistTitle>
          </ChecklistRow>
        </Checklist>
      </Specimen>
      <Specimen label='Markdown task list · agent prose and notes, read-only, nested content kept'>
        <div className='w-full max-w-xl'>
          <Markdown text={TASK_LIST_SAMPLE} />
        </div>
      </Specimen>
      <Specimen label='Markdown task list · in chat prose'>
        <div className='w-full max-w-xl'>
          <Markdown text={TASK_LIST_SAMPLE} className='prose-chat' />
        </div>
      </Specimen>
    </Section>
  );
}
