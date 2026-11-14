import { Option } from 'effect';
import { isSupportingWorkPath } from './area.ts';
import { AUTOPILOT_WORK_LIMITS, type AutopilotWorkSurface } from './schema.ts';

const UI_PATH =
  /\.(?:tsx|jsx|css|scss|sass|less|html|vue|svelte|astro|svg|storyboard|xib)$|(?:^|\/)(?:components|routes|pages|screens|views|ui|styles)\//i;

export function selectWorkSurface(paths: readonly string[]): Option.Option<AutopilotWorkSurface> {
  const code = paths.filter((path) => !isSupportingWorkPath(path));
  if (code.length === 0) return paths.length > 0 ? Option.some('docs') : Option.none();
  const ui = code.filter((path) => UI_PATH.test(path)).length / code.length;
  if (ui >= AUTOPILOT_WORK_LIMITS.uiShare) return Option.some('ui');
  if (ui <= 1 - AUTOPILOT_WORK_LIMITS.uiShare) return Option.some('logic');
  return Option.some('mixed');
}
