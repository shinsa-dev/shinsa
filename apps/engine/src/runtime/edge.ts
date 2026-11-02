import { BunServices } from '@effect/platform-bun';
import { Layer, ManagedRuntime } from 'effect';
import { AccountsLayer } from '../accounts/layers.ts';
import { ChecksLayer } from '../checks/layers.ts';
import { MachineConfigFile } from '../config/machine/service.ts';
import { ExtensionsLayer } from '../extensions/layers.ts';
import { FeedbackIssues } from '../feedback/issues/service.ts';
import { JsonFile } from '../files/service.ts';
import { GitLayer } from '../git/layers.ts';
import { GitHubLayer } from '../github/layers.ts';
import { JsonLogger } from '../log/service.ts';
import { ReposLayer } from '../repos/layers.ts';
import { SecretFiles } from '../secrets/files/service.ts';
import { Shell } from '../shell/service.ts';
import { TerminalsLayer } from '../terminals/layers.ts';
import { VersionsLayer } from '../versions/layers.ts';
import { WorkspacesLayer } from '../workspaces/layers.ts';

const ShellLayer = Shell.layer.pipe(Layer.provideMerge(BunServices.layer));

export const edgeRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    JsonLogger,
    MachineConfigFile.layer,
    Layer.mergeAll(
      ReposLayer,
      WorkspacesLayer,
      ChecksLayer,
      TerminalsLayer,
      ExtensionsLayer,
      FeedbackIssues.layer,
      SecretFiles.layer,
      AccountsLayer,
      VersionsLayer
    ).pipe(
      Layer.provideMerge(JsonFile.layer),
      Layer.provideMerge(Layer.merge(GitLayer, GitHubLayer)),
      Layer.provideMerge(ShellLayer)
    )
  )
);
