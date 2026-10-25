import type { ChatEvent, ChatTool, ReviewFinding } from '../packages/core/src/index.ts';
import {
  type CodeSample,
  LIVE_PLAN,
  listGrepMatches,
  listReviewFindings,
  MERGED_PLAN,
  MERGED_REVIEW_SUMMARY,
  PULL_REQUEST_NUMBER,
  REVIEW_PLAN,
  REVIEW_SUMMARY,
  resolveReviewReport,
  SAMPLE_ANSWER,
  SAMPLE_LIVE,
  SAMPLE_MERGED,
  SAMPLE_PATHS,
  SAMPLE_REVIEW,
} from './seed-code.ts';
import { listEditHunks, resolveLine, serializeNumberedLines } from './seed-code-kit.ts';
import {
  callTool,
  MINUTE,
  NOW,
  resolveToolOutput,
  say,
  spreadEvents,
  type TimedSeedEvent,
  writeTranscript,
} from './seed-kit.ts';
import { listRunOpenings } from './seed-prompts.ts';

interface Step {
  call: ChatTool;
  output?: string;
}

function brief(role: string, title: string, task: string): ChatEvent {
  return {
    type: 'user',
    from: 'shinsa',
    text: `You are the ${role} for “${title}”.\n\n${task}\n\nWork in the task's worktree and hand over through the Shinsa tools.`,
    attachments: [],
  };
}

function resolveOpening(openings: ReadonlyMap<string, string>, runId: string): ChatEvent {
  const text = openings.get(runId);
  if (!text) throw new Error(`The seed has no prompt for run ${runId}.`);
  return { type: 'user', from: 'shinsa', text, attachments: [] };
}

function read(
  path: string,
  content: string,
  start = 1,
  end = Math.min(40, content.split('\n').length)
): Step {
  return {
    call: { kind: 'read', path, range: { start, end } },
    output: serializeNumberedLines(content, start, end),
  };
}

function search(query: string, output: string, path: string | null = null): Step {
  return { call: { kind: 'search', mode: 'content', query, path }, output };
}

function run(command: string, description: string, output: string): Step {
  return { call: { kind: 'command', action: 'run', command, description }, output };
}

function edit(path: string, before: string, after: string): Step {
  return {
    call: { kind: 'edit', path, hunks: listEditHunks(before, after) },
    output: 'The file has been updated.',
  };
}

function write(path: string, content: string): Step {
  return { call: { kind: 'write', path, content }, output: `File created: ${path}` };
}

function handOver(
  name: Extract<ChatTool, { kind: 'shinsa' }>['name'],
  args: Record<string, unknown>,
  output: string
): Step {
  return { call: { kind: 'shinsa', name, args }, output };
}

function listMatches(path: string, content: string, needle: string) {
  return content
    .split('\n')
    .flatMap((line, index) => (line.includes(needle) ? [`${path}:${index + 1}:${line}`] : []))
    .join('\n');
}

function serializeRun(runId: string, opening: ChatEvent[], steps: (Step | ChatEvent)[], ending: ChatEvent[]) {
  const events: ChatEvent[] = [{ type: 'status', status: 'started', outcome: null }, ...opening];
  for (const [index, step] of steps.entries()) {
    if ('type' in step) {
      events.push(step);
      continue;
    }
    const callId = `${runId}-call-${index}`;
    events.push(callTool(callId, step.call));
    if (step.output !== undefined) events.push(resolveToolOutput(callId, step.output));
  }
  return [...events, ...ending];
}

function finish(text: string): ChatEvent[] {
  return [
    { type: 'agent', phase: 'final', text },
    { type: 'status', status: 'ended', outcome: 'completed' },
  ];
}

function serializeFinding(finding: ReviewFinding) {
  return {
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    end: finding.end ?? null,
    title: finding.title,
    message: finding.message,
    fix: finding.fix,
  };
}

function listReviewRuns(sample: CodeSample, openings: ReadonlyMap<string, string>) {
  const { review } = sample;
  const title = 'Rename review targets to review spots';
  const { phases } = resolveReviewReport(sample, []);
  const findings = listReviewFindings(sample);
  const lock = review.lock;
  const spotKeyLine = resolveLine(review.spotKeys.after, 'const match =');
  const rankedLine = resolveLine(review.ranking, 'export function listRankedSpots');
  const designLine = resolveLine(review.design.after, '## Review spots');
  const request =
    'The request: Rename review targets to review spots in the web app. Core and the agents already say spot; the web still says target.';
  const handOverPhase = (index: number) => ({
    summary: phases[index]?.summary,
    spots: phases[index]?.spots,
    judgement_calls: phases[index]?.judgementCalls,
  });
  return {
    0: serializeRun(
      `${SAMPLE_REVIEW}-run-0`,
      [resolveOpening(openings, `${SAMPLE_REVIEW}-run-0`)],
      [
        say('I’ll find every place the web still says target, then check what core calls the same thing.'),
        search('lib/review/targets.ts', review.importers, 'apps'),
        read(SAMPLE_PATHS.targets, review.spots.before, 1, 60),
        search('listRankedSpots', listGrepMatches(sample.repo.path, 'listRankedSpots', 'main'), 'packages'),
        read(SAMPLE_PATHS.ranking, review.ranking, Math.max(1, rankedLine - 4), rankedLine + 12),
        say(
          'Core already ranks spots with listRankedSpots; only the web module and its three callers say target. Settings, schedules and MCP code use target for something else and stay out of it.'
        ),
        {
          call: {
            kind: 'todo',
            todos: REVIEW_PLAN.phases.map((phase) => ({ text: phase.title, status: 'pending' as const })),
          },
          output: 'Todos updated.',
        },
        handOver('propose_plan', { ...REVIEW_PLAN }, 'Plan recorded. Building starts with phase 1.'),
      ],
      finish(
        'Proposed three phases: rename the module, update its three callers and the fixture, then the docs.'
      )
    ),
    1: serializeRun(
      `${SAMPLE_REVIEW}-run-1`,
      [resolveOpening(openings, `${SAMPLE_REVIEW}-run-1`)],
      [
        read(SAMPLE_PATHS.targets, review.spots.before, 1, 60),
        run(`git mv ${SAMPLE_PATHS.targets} ${SAMPLE_PATHS.spots}`, 'Rename the module', ''),
        edit(SAMPLE_PATHS.spots, review.spots.before, review.spotsRenamed),
        say(
          'Spot keys are built in two places from the same template. I’ll give them a module of their own.'
        ),
        write(SAMPLE_PATHS.spotKeys, review.spotKeys.before),
        edit(SAMPLE_PATHS.spots, review.spotsRenamed, review.spots.after),
        run(`git rm -q ${SAMPLE_PATHS.targetsTest}`, 'Remove the old tests', ''),
        write(SAMPLE_PATHS.spotsTest, review.spotsTest.before),
        run(
          'bun install',
          'Install after the move',
          `bun install v1.4.2\n\n~ ${lock.name}@${lock.to}\n\n1 package installed [384.00ms]\nSaved lockfile`
        ),
        run(
          'bun test apps/web/test/lib/review',
          'Run the review tests',
          'apps/web/test/lib/review/spots.test.ts:\n(pass) listReviewSpots > lists every spot of a recorded review in both orders\n(pass) listReviewSpots > puts critical spots first when ordered by attention\n(pass) stepSpot > wraps around at both ends\n(pass) spot keys > round-trips a section and a spot\n(pass) spot keys > ignores any other key\n(pass) spot keys > shows one line without a range\n\n 6 pass\n 0 fail\n 8 expect() calls\nRan 6 tests across 4 files. [212.00ms]'
        ),
        handOver('complete_phase', handOverPhase(0), 'Phase 1 committed.'),
      ],
      finish(
        `Renamed the module and moved spot keys into spot-keys.ts. bun.lock moved ${lock.name} to ${lock.to} on install.`
      )
    ),
    2: serializeRun(
      `${SAMPLE_REVIEW}-run-2`,
      [resolveOpening(openings, `${SAMPLE_REVIEW}-run-2`)],
      [
        search('lib/review/targets.ts', review.importers, 'apps'),
        edit(SAMPLE_PATHS.review, review.review.before, review.review.after),
        edit(SAMPLE_PATHS.changes, review.changes.before, review.changes.after),
        edit(SAMPLE_PATHS.codeView, review.codeView.before, review.codeView.after),
        say('The recorded fixture still exports a TARGET count, and two of its why texts say target.'),
        search(
          'target',
          listMatches(SAMPLE_PATHS.fixture, review.fixture.before, 'TARGET'),
          SAMPLE_PATHS.fixture
        ),
        edit(SAMPLE_PATHS.fixture, review.fixture.before, review.fixture.after),
        edit(SAMPLE_PATHS.spotsTest, review.spotsTest.before, review.spotsTest.after),
        run(
          'bun check-types',
          'Type-check every workspace',
          ' Tasks:    5 successful, 5 total\nCached:    1 cached, 5 total\n  Time:    9.412s'
        ),
        run(
          'bun test apps/web/test/lib/review',
          'Run the review tests',
          ' 6 pass\n 0 fail\n 8 expect() calls\nRan 6 tests across 4 files. [198.00ms]'
        ),
        handOver('complete_phase', handOverPhase(1), 'Phase 2 committed.'),
      ],
      finish(
        'The review, the changes list and the code view import from spots.ts, and the fixture says spot.'
      )
    ),
    3: serializeRun(
      `${SAMPLE_REVIEW}-run-3`,
      [resolveOpening(openings, `${SAMPLE_REVIEW}-run-3`)],
      [
        read(SAMPLE_PATHS.design, review.design.before, Math.max(1, designLine - 8), designLine),
        edit(SAMPLE_PATHS.design, review.design.before, review.design.after),
        {
          call: {
            kind: 'browser',
            action: 'navigate',
            name: 'browser_navigate',
            target: 'http://localhost:5181/tasks/SMP-2?tab=code',
            code: null,
            args: {},
          },
          output: 'Navigated to the task’s code tab.',
        },
        {
          call: {
            kind: 'browser',
            action: 'screenshot',
            name: 'browser_take_screenshot',
            target: null,
            code: null,
            args: { filename: '/tmp/review.png' },
          },
          output: 'Saved /tmp/review.png (640×400).',
        },
        run(`cp /tmp/review.png ${SAMPLE_PATHS.screenshot}`, 'Replace the screenshot', ''),
        handOver('complete_phase', handOverPhase(2), 'Phase 3 committed. Checks run next.'),
      ],
      finish('The design doc has a Review spots section with a new screenshot.')
    ),
    4: serializeRun(
      `${SAMPLE_REVIEW}-run-4`,
      [resolveOpening(openings, `${SAMPLE_REVIEW}-run-4`)],
      [
        search('SpotKey', listMatches(SAMPLE_PATHS.spotKeys, review.spotKeys.before, 'SpotKey'), 'apps/web'),
        say('Nothing outside spot-keys.ts uses the type, so it does not need to be exported.'),
        edit(SAMPLE_PATHS.spotKeys, review.spotKeys.before, review.spotKeys.after),
        run('bunx knip', 'Check for unused exports', '✂️  Excellent, Knip found no issues.'),
        handOver(
          'complete_fix',
          { summary: 'SpotKey is no longer exported; knip passes.' },
          'Fix committed. Checks run again.'
        ),
      ],
      finish('SpotKey is local to spot-keys.ts now, and knip passes.')
    ),
    5: serializeRun(
      `${SAMPLE_REVIEW}-run-5`,
      [brief('reviewer', title, `${request}\n\nReview the branch against main and report findings.`)],
      [
        run('git diff --stat --find-renames main', 'What changed on the branch', review.diffStat),
        read(SAMPLE_PATHS.spotKeys, review.spotKeys.after),
        search(
          'parseSpotKey',
          [
            listMatches(SAMPLE_PATHS.spotKeys, review.spotKeys.after, 'parseSpotKey'),
            listMatches(SAMPLE_PATHS.spotsTest, review.spotsTest.after, 'parseSpotKey'),
          ].join('\n'),
          'apps/web'
        ),
        say(
          `Links built before this change can carry finding:2 or a decision key, and parseSpotKey at line ${spotKeyLine} drops both. That is a behaviour change in a rename.`
        ),
        read(
          SAMPLE_PATHS.spots,
          review.spots.after,
          resolveLine(review.spots.after, 'export function listFindingSpots'),
          resolveLine(review.spots.after, 'export function listFindingMarkers') + 16
        ),
        search(
          'Review targets',
          listMatches(SAMPLE_PATHS.webGuide, review.webGuide.before, 'Review targets'),
          'apps/web'
        ),
        handOver(
          'report_review',
          { summary: REVIEW_SUMMARY, findings: findings.map(serializeFinding) },
          'Review recorded.'
        ),
      ],
      finish(
        `One blocking finding: [parseSpotKey](shinsa://file/${SAMPLE_PATHS.spotKeys}#L${spotKeyLine}) drops finding and decision keys, so older links to an agent finding open nothing. Four suggestions, none blocking. The rename itself is clean and the [recorded fixture](shinsa://file/${SAMPLE_PATHS.fixture}) still loads all of its spots.`
      )
    ),
  };
}

function listMergedRuns(sample: CodeSample, openings: ReadonlyMap<string, string>) {
  const title = 'Stack the queue by priority';
  const request = 'The request: Stack the queue by priority: urgent work should sit on top inside each gate.';
  const { index } = sample.merged;
  return {
    0: serializeRun(
      `${SAMPLE_MERGED}-run-0`,
      [resolveOpening(openings, `${SAMPLE_MERGED}-run-0`)],
      [
        search(
          'resolveQueue',
          listGrepMatches(sample.repo.path, 'export function resolveQueue', 'main~1'),
          'packages/core'
        ),
        read(SAMPLE_PATHS.queueIndex, index.before),
        handOver('propose_plan', { ...MERGED_PLAN }, 'Plan recorded.'),
      ],
      finish('Two phases: the helper, then its tests.')
    ),
    1: serializeRun(
      `${SAMPLE_MERGED}-run-1`,
      [resolveOpening(openings, `${SAMPLE_MERGED}-run-1`)],
      [
        write(SAMPLE_PATHS.queueStack, sample.merged.stack),
        edit(SAMPLE_PATHS.queueIndex, index.before, index.after),
        run('bun check-types', 'Type-check every workspace', ' Tasks:    5 successful, 5 total'),
        handOver(
          'complete_phase',
          { summary: 'stackByPriority sorts by priority, then by age.' },
          'Phase 1 committed.'
        ),
      ],
      finish('Added stackByPriority to the queue.')
    ),
    2: serializeRun(
      `${SAMPLE_MERGED}-run-2`,
      [resolveOpening(openings, `${SAMPLE_MERGED}-run-2`)],
      [
        write(SAMPLE_PATHS.queueTest, sample.merged.test),
        run(
          'bun test packages/core/test/queue/stack.test.ts',
          'Run the new tests',
          ' 2 pass\n 0 fail\n 2 expect() calls'
        ),
        handOver(
          'complete_phase',
          { summary: 'Two tests for the order and the untouched input.' },
          'Phase 2 committed.'
        ),
      ],
      finish('Covered the order with two tests.')
    ),
    3: serializeRun(
      `${SAMPLE_MERGED}-run-3`,
      [brief('reviewer', title, `${request}\n\nReview the branch against main and report findings.`)],
      [
        read(SAMPLE_PATHS.queueStack, sample.merged.stack),
        handOver('report_review', { summary: MERGED_REVIEW_SUMMARY, findings: [] }, 'Review recorded.'),
      ],
      finish(`No findings. Pull request #${PULL_REQUEST_NUMBER} can go as it is.`)
    ),
  };
}

function listLiveRuns(sample: CodeSample, openings: ReadonlyMap<string, string>) {
  const { live } = sample;
  const tokensLine = resolveLine(live.tokens.after, '--code-keyword');
  return {
    0: serializeRun(
      `${SAMPLE_LIVE}-run-0`,
      [resolveOpening(openings, `${SAMPLE_LIVE}-run-0`)],
      [
        read(SAMPLE_PATHS.highlight, live.highlight.before),
        search('--shiki', listGrepMatches(sample.repo.path, '--shiki', 'main'), 'apps/web'),
        handOver('propose_plan', { ...LIVE_PLAN }, 'Plan recorded.'),
      ],
      finish('Three phases: the tokens, the highlighter theme, then screenshots in both themes.')
    ),
    1: serializeRun(
      `${SAMPLE_LIVE}-run-1`,
      [resolveOpening(openings, `${SAMPLE_LIVE}-run-1`)],
      [
        edit(SAMPLE_PATHS.tokens, live.tokens.before, live.tokens.after),
        handOver(
          'complete_phase',
          { summary: 'Six code colour tokens for light and dark.' },
          'Phase 1 committed.'
        ),
      ],
      finish(`Added the tokens from line ${tokensLine - 2} of the kit’s globals.`)
    ),
    2: serializeRun(
      `${SAMPLE_LIVE}-run-2`,
      [resolveOpening(openings, `${SAMPLE_LIVE}-run-2`)],
      [
        read(SAMPLE_PATHS.highlight, live.highlight.before),
        say(
          'Shiki hands each token its scopes. A small map from scope to token keeps the highlighter itself untouched.'
        ),
        write(SAMPLE_PATHS.theme, live.theme),
        edit(SAMPLE_PATHS.highlight, live.highlight.before, live.highlight.after),
        say(
          'Now the highlighter reads the theme. Running the code tests before I switch the token colours over.'
        ),
        {
          call: {
            kind: 'command',
            action: 'run',
            command: 'bun test apps/web/test/lib/code',
            description: 'Run the code view tests',
          },
        },
      ],
      []
    ),
  };
}

function listAnswerRuns(sample: CodeSample) {
  const ranking = sample.review.ranking;
  const line = resolveLine(ranking, 'export function listRankedSpots');
  return {
    0: serializeRun(
      `${SAMPLE_ANSWER}-run-0`,
      [
        brief(
          'answerer',
          'How the review orders spots by attention',
          'The request: How does the review decide the order of spots when I sort by attention?'
        ),
      ],
      [
        search("'attention'", listGrepMatches(sample.repo.path, "'attention'", 'main'), 'apps/web/src'),
        read(SAMPLE_PATHS.ranking, ranking, Math.max(1, line - 4), line + 12),
        read(SAMPLE_PATHS.targets, sample.review.spots.before, 1, 60),
        handOver(
          'answer',
          {
            answer: 'Critical first, then high, then normal; inside a rank, the order the agents wrote them.',
          },
          'Answer delivered.'
        ),
      ],
      finish('Critical first, then high, then normal; inside one rank, the order the agents wrote them.')
    ),
  };
}

function resolveWindow(timeline: TimedSeedEvent[], runId: string) {
  let from: number | null = null;
  let to: number | null = null;
  for (const { at, event } of timeline) {
    if (event.type === 'run.started' && event.run.id === runId) from = at;
    if (event.type === 'run.ended' && event.runId === runId) to = at;
  }
  return from === null ? null : { from, to: to ?? NOW - MINUTE };
}

export function writeCodeTranscripts(dir: string, timeline: TimedSeedEvent[], sample: CodeSample) {
  const openings = listRunOpenings(timeline);
  const runs: [string, Record<number, ChatEvent[]>][] = [
    [SAMPLE_REVIEW, listReviewRuns(sample, openings)],
    [SAMPLE_MERGED, listMergedRuns(sample, openings)],
    [SAMPLE_LIVE, listLiveRuns(sample, openings)],
    [SAMPLE_ANSWER, listAnswerRuns(sample)],
  ];
  for (const [taskId, events] of runs) {
    for (const [index, list] of Object.entries(events)) {
      const runId = `${taskId}-run-${index}`;
      const window = resolveWindow(timeline, runId);
      if (!window) throw new Error(`The seed has no run ${runId}.`);
      writeTranscript(dir, runId, spreadEvents(list, window.from, window.to));
    }
  }
}
