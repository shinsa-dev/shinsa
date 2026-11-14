import { AUTOPILOT_WORK_LIMITS, type AutopilotWorkSize } from './schema.ts';

export function resolveWorkSize(scope: { phases: number; files: number }): AutopilotWorkSize {
  const { small, large } = AUTOPILOT_WORK_LIMITS;
  if (scope.phases >= large.phases || scope.files >= large.files) return 'large';
  if (scope.phases <= small.phases && scope.files <= small.files) return 'small';
  return 'medium';
}
