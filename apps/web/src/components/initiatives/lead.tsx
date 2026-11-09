import type { Initiative } from '@shinsa/core';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

export function LeadReport({ initiative }: { initiative: Initiative }) {
  if (!initiative.report) return null;
  return (
    <Panel
      persistId={createDisclosureId('initiative', initiative.id, 'report')}
      title='Where it stands'
      icon='IconAgents'
    >
      <Markdown text={initiative.report.narrative} className='text-fg-4' />
    </Panel>
  );
}
