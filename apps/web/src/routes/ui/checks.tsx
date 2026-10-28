import { Card } from '@shinsa/ui/components/card';
import * as React from 'react';
import { ChecksBlock, ChecksSections } from '@/components/checks/checks-list.tsx';
import { EvidencePanel } from '@/components/evidence/evidence-section.tsx';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { PlanParameterList } from '@/components/overview/plan-parameters.tsx';
import { BaselineSelect } from '@/components/settings/baseline-select.tsx';
import { recordEvidenceText } from '@/lib/evidence/texts.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { type ChecksSpecimen, createChecksScene, SAMPLE_PLAN_CHECKS, SAMPLE_REPO } from './sample-checks.ts';
import { SAMPLE_EVIDENCE_TEXTS } from './sample-evidence.ts';
import { acknowledgeSample } from './samples.ts';
import { Specimen } from './section.tsx';

const LIST_SPECIMENS: { key: ChecksSpecimen; label: string }[] = [
  {
    key: 'running',
    label:
      'ChecksBlock · running the checks for phase 2 of 3: the phase’s checks spin, the next phase’s and the repository’s wait as Not run yet',
  },
  {
    key: 'passed',
    label:
      'ChecksBlock · all passed before review: the plan’s checks with their phases, one the agent added, and the repository’s Always run before review command',
  },
  { key: 'failing', label: 'ChecksBlock · a failing check, with what failed under its command' },
  { key: 'alone', label: 'ChecksBlock · a check that failed under load and passed when re-run alone' },
  { key: 'base', label: 'ChecksBlock · a check already failing on main, which does not block' },
  {
    key: 'ci',
    label:
      'ChecksBlock · after the pull request: the checks from building, then CI’s checks (required or optional, linked)',
  },
];

function recordSampleTexts() {
  for (const [uri, body] of SAMPLE_EVIDENCE_TEXTS) recordEvidenceText(uri, body);
  return true;
}

export function ChecksSpecimens() {
  React.useState(recordSampleTexts);
  const [scene] = React.useState(() => createChecksScene(Date.now()));
  return (
    <>
      {LIST_SPECIMENS.map((specimen) => (
        <Specimen key={specimen.key} label={specimen.label}>
          <Card className='w-full max-w-xl p-3'>
            <ChecksBlock taskId={`ui-${specimen.key}`} view={scene.views[specimen.key]} />
          </Card>
        </Specimen>
      ))}
      <Specimen label='ChecksSections · the checks fact’s popover and the pull request’s, both stages in one list'>
        <Card className='w-72 py-1'>
          <ChecksSections view={scene.views.ci} />
        </Card>
        <Card className='w-72 py-1'>
          <ChecksSections view={scene.views.running} />
        </Card>
      </Specimen>
      <Specimen label='EvidencePanel · a test the agent linked reads as its check: label, command, outcome, the agent’s note and Shinsa’s latest output; a check Shinsa ran on its own'>
        <div className='w-full max-w-2xl'>
          <EvidencePanel
            layout={scene.evidence}
            persistId={createDisclosureId('ui', 'checks', 'evidence')}
            checks={scene.evidenceChecks}
          />
        </div>
      </Specimen>
      <Specimen label='PlanParameterList · the plan’s Checks: each label, its phases and its command'>
        <Card className='w-full max-w-xl p-3'>
          <PlanParameterList
            document={{ verification: SAMPLE_PLAN_CHECKS, evidence: ['test', 'screenshot'] }}
          />
        </Card>
      </Specimen>
      <Specimen label='ActivityRow · a check the agent added, and a run of the checks'>
        <Card className='w-full max-w-xl p-3'>
          <ul className='flex flex-col'>
            {scene.activity.map((entry) => (
              <ActivityRow key={entry.text} entry={entry} state={scene.state} onOpenRun={acknowledgeSample} />
            ))}
          </ul>
        </Card>
      </Specimen>
      <Specimen label='BaselineSelect · Settings → Projects: a repository’s Always run before review commands, or nothing'>
        <BaselineSelect repo={SAMPLE_REPO} onChange={acknowledgeSample} />
        <BaselineSelect repo={{ ...SAMPLE_REPO, checkCommands: [] }} onChange={acknowledgeSample} />
      </Specimen>
    </>
  );
}
