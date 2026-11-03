import { Layer } from 'effect';
import { RepoFolders } from './folders/service.ts';
import { GitHubLogins } from './login/service.ts';
import { RepoSetup } from './setup/service.ts';

export const ReposLayer = Layer.mergeAll(RepoFolders.layer, RepoSetup.layer, GitHubLogins.layer);
