import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

describe('other work in the repository', () => {
  test('an agent that commits a file another open task changed is told once, on its next turn, and can list that work', async () => {
    const w = await World.create();
    world = w;
    const first = await w.createTask('Add the greeting files');
    await w.untilStage(first, 'awaiting_review');
    let listed = '';
    w.agents.queue('plan', async (agent) => {
      listed = await agent.call('list_repository_work', {});
      await agent.call('propose_plan', {
        goal: 'Add the greeting files again.',
        phases: [
          { title: 'Write the first file', detail: 'Create a.txt.' },
          { title: 'Write the second file', detail: 'Create b.txt.' },
        ],
        behaviour: ['Both files exist.'],
        approach: 'Write them.',
        files: [],
        out_of_scope: [],
        verification: ['The checks pass.'],
        questions: [],
      });
    });
    const second = await w.createTask('Greet again');
    await w.untilStage(second, 'awaiting_review');

    const other = w.task(first);
    expect(listed).toContain(`[${other.title}](shinsa://task/${first}) · changes to review`);
    expect(listed).toContain('  Changed files: a.txt, b.txt.');
    const builds = Object.values(w.state.runs).filter(
      (run) => run.taskId === second && run.purpose === 'build'
    );
    const note = `Another open task changed files this task also changes: ${other.handle} “${other.title}” (\`a.txt\`)`;
    expect(builds[1]?.prompt).toContain(note);
    expect(builds[0]?.prompt).not.toContain('Another open task');
    expect(w.task(second).overlaps).toEqual([
      { taskId: first, paths: ['a.txt', 'b.txt'], untold: ['b.txt'] },
    ]);
    expect(w.task(first).overlaps?.map((overlap) => overlap.taskId)).toEqual([second]);
  });
});
