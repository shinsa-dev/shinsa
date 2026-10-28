import * as React from 'react';
import { EvidencePanel } from '@/components/evidence/evidence-section.tsx';
import { recordEvidenceText } from '@/lib/evidence/texts.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { SAMPLE_EVIDENCE_CHECKS, SAMPLE_EVIDENCE_LAYOUT, SAMPLE_EVIDENCE_TEXTS } from './sample-evidence.ts';
import { Specimen } from './section.tsx';

function recordSampleTexts() {
  for (const [uri, body] of SAMPLE_EVIDENCE_TEXTS) recordEvidenceText(uri, body);
  return true;
}

export function EvidenceSpecimens() {
  React.useState(recordSampleTexts);
  return (
    <Specimen label='EvidencePanel · one group per kind of evidence: a comparison (before and after as one item), a recording that plays in the image viewer, a screenshot, the test the agent linked, shown as its check with Shinsa’s latest output, a check Shinsa ran, a note and a preview, then where the files are kept; a click on a shot opens the image viewer, which steps item by item and switches Before and After inside a comparison'>
      <div className='w-full max-w-2xl'>
        <EvidencePanel
          layout={SAMPLE_EVIDENCE_LAYOUT}
          checks={SAMPLE_EVIDENCE_CHECKS}
          persistId={createDisclosureId('ui', 'evidence', 'panel')}
        />
      </div>
    </Specimen>
  );
}
