import { Schema } from 'effect';

const WorktreeRootSource = Schema.Literals(['environment', 'config', 'default']);
type WorktreeRootSource = typeof WorktreeRootSource.Type;

export const ResolvedWorktreeRoot = Schema.Struct({
  path: Schema.String,
  source: WorktreeRootSource,
});
export type ResolvedWorktreeRoot = typeof ResolvedWorktreeRoot.Type;

export class WorktreeRootUnavailable extends Schema.TaggedError<
  WorktreeRootUnavailable,
  { readonly brand: unique symbol }
>()('WorktreeRootUnavailable', { path: Schema.String, message: Schema.String }) {}

export interface WorktreeRootOptions {
  readonly defaultDir: string;
  readonly fromEnvironment?: boolean;
  readonly readConfigured?: () => string | null;
}
