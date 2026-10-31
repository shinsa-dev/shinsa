import badgeAfter from '../assets/shinsa-change/after/apps/web/src/components/tasks/pull-request-badge.tsx.txt?raw';
import rowAfter from '../assets/shinsa-change/after/apps/web/src/components/tasks/row.tsx.txt?raw';
import toneAfter from '../assets/shinsa-change/after/apps/web/src/lib/format/tone.ts.txt?raw';
import badgeBefore from '../assets/shinsa-change/before/apps/web/src/components/tasks/pull-request-badge.tsx.txt?raw';
import rowBefore from '../assets/shinsa-change/before/apps/web/src/components/tasks/row.tsx.txt?raw';
import toneBefore from '../assets/shinsa-change/before/apps/web/src/lib/format/tone.ts.txt?raw';
import group from '../assets/shinsa-change/same/apps/web/src/components/tasks/group.tsx.txt?raw';
import waitsOn from '../assets/shinsa-change/same/apps/web/src/components/tasks/waits-on.tsx.txt?raw';
import pullRequest from '../assets/shinsa-change/same/apps/web/src/lib/tasks/pull-request.ts.txt?raw';
import status from '../assets/shinsa-change/same/apps/web/src/lib/tasks/status.ts.txt?raw';
import tasksRoute from '../assets/shinsa-change/same/apps/web/src/routes/tasks.tsx.txt?raw';
import rowTest from '../assets/shinsa-change/same/apps/web/test/components/tasks/row.test.tsx.txt?raw';

export const ROW_PATH = 'apps/web/src/components/tasks/row.tsx';

export const BADGE_PATH = 'apps/web/src/components/tasks/pull-request-badge.tsx';

export const TONE_PATH = 'apps/web/src/lib/format/tone.ts';

export const TINT_CHANGES = {
  [ROW_PATH]: { before: rowBefore, after: rowAfter },
  [BADGE_PATH]: { before: badgeBefore, after: badgeAfter },
  [TONE_PATH]: { before: toneBefore, after: toneAfter },
};

export const TINT_UNCHANGED: Record<string, string> = {
  'apps/web/src/components/tasks/group.tsx': group,
  'apps/web/src/components/tasks/waits-on.tsx': waitsOn,
  'apps/web/src/lib/tasks/pull-request.ts': pullRequest,
  'apps/web/src/lib/tasks/status.ts': status,
  'apps/web/src/routes/tasks.tsx': tasksRoute,
  'apps/web/test/components/tasks/row.test.tsx': rowTest,
};
