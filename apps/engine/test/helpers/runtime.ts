import { Layer, ManagedRuntime } from 'effect';
import { ChecksLayer } from '../../src/checks/layers.ts';
import { MachineConfigFile } from '../../src/config/machine/service.ts';
import { ExtensionsLayer } from '../../src/extensions/layers.ts';
import { JsonFile } from '../../src/files/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { GitHubLayer } from '../../src/github/layers.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { ReposLayer } from '../../src/repos/layers.ts';
import { SecretFiles } from '../../src/secrets/files/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { TerminalsLayer } from '../../src/terminals/layers.ts';
import { WorkspacesLayer } from '../../src/workspaces/layers.ts';

export const testRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    JsonLogger,
    MachineConfigFile.layer,
    Layer.mergeAll(
      ReposLayer,
      WorkspacesLayer,
      ChecksLayer,
      TerminalsLayer,
      ExtensionsLayer,
      SecretFiles.layer
    ).pipe(
      Layer.provideMerge(JsonFile.layer),
      Layer.provideMerge(Layer.merge(GitLayer, GitHubLayer)),
      Layer.provideMerge(ShellLayer)
    )
  )
);
