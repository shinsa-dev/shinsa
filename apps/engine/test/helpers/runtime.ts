import { Layer, ManagedRuntime } from 'effect';
import { ChecksLayer } from '../../src/checks/layers.ts';
import { MachineConfigFile } from '../../src/config/machine/service.ts';
import { ExtensionsLayer } from '../../src/extensions/layers.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { ReposLayer } from '../../src/repos/layers.ts';
import { SecretFiles } from '../../src/secrets/files/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { TerminalsLayer } from '../../src/terminals/layers.ts';
import { WorktreeWorkspaces } from '../../src/workspaces/worktrees-mode/service.ts';
import { JsonFileLayer } from './files.ts';

export const testRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    JsonLogger,
    Layer.mergeAll(
      MachineConfigFile.layer,
      ReposLayer,
      WorktreeWorkspaces.layer,
      ChecksLayer,
      TerminalsLayer,
      ExtensionsLayer,
      SecretFiles.layer
    ).pipe(
      Layer.provideMerge(JsonFileLayer),
      Layer.provideMerge(Layer.merge(GitLayer, GitHubLayer)),
      Layer.provideMerge(ShellLayer)
    )
  )
);
