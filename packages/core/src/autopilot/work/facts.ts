import { Option } from 'effect';
import type { Task } from '../../domain/types.ts';
import { selectWorkArea } from './area.ts';
import { selectWorkNovelty } from './novelty.ts';
import type { AutopilotWorkFacts } from './schema.ts';
import { resolveWorkSize } from './size.ts';
import { selectWorkSurface } from './surface.ts';
import { listWorkTerms } from './terms.ts';

type WorkTask = Pick<Task, 'title' | 'request' | 'plan'>;

export function resolveAutopilotWorkFacts(task: WorkTask): AutopilotWorkFacts {
  const document = task.plan?.document ?? null;
  const paths = document?.files.map((file) => file.path) ?? [];
  const words = [task.title, task.request].join('\n');
  return {
    area: Option.getOrNull(selectWorkArea(paths)),
    surface: Option.getOrNull(selectWorkSurface(paths)),
    novelty: Option.getOrNull(selectWorkNovelty([words, document?.goal ?? ''].join('\n'))),
    size: document ? resolveWorkSize({ phases: document.phases.length, files: document.files.length }) : null,
    terms: listWorkTerms(words),
  };
}
