import { PROJECT_COLORS, resolveProjectKey, selectFolderProject } from './projects.ts';
import type { Project } from './types.ts';

export interface SuggestionRepo {
  path: string;
  name: string;
  remote: string | null;
  projectId: string | null;
}

export interface ProjectSuggestion {
  id: string;
  name: string;
  key: string;
  color: string;
  projectId: string | null;
  folders: string[];
  repos: { path: string; name: string }[];
}

interface SuggestionInput {
  roots: string[];
  repos: SuggestionRepo[];
  login: string | null;
  projects: Project[];
}

interface Group {
  id: string;
  owner: string | null;
  stem: string | null;
  repos: SuggestionRepo[];
}

const PERSONAL_ID = 'personal';

const PERSONAL_NAME = 'Personal';

const MIN_OWNER_REPOS = 2;

const MIN_STEM_REMOTES = 3;

const FOLDER_SHARE = 2 / 3;

const OWNER_SUFFIX = /[-_]?(dev|hq|inc|labs|studio|team|org|app|io)$/i;

function readRemote(remote: string | null) {
  if (!remote) return null;
  const [, owner, name] = remote.split('/');
  if (!owner || !name) return null;
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

function resolveStem(name: string) {
  return name.toLowerCase().split(/[-_.\s]+/)[0] ?? name.toLowerCase();
}

function resolveParent(path: string) {
  return path.slice(0, path.lastIndexOf('/'));
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function resolveOwnerName(owner: string) {
  const bare = owner.replace(OWNER_SUFFIX, '') || owner;
  return bare.split(/[-_]+/).map(capitalize).join(' ');
}

function resolveGroupName(group: Group) {
  if (group.id === PERSONAL_ID) return PERSONAL_NAME;
  const word = group.stem ?? resolveOwnerName(group.owner ?? '');
  const folder = group.repos
    .map((repo) => repo.name)
    .find((name) => name.toLowerCase() === word.toLowerCase() && name !== name.toLowerCase());
  return folder ?? capitalize(word);
}

function addRepo(
  groups: Map<string, Group>,
  id: string,
  fields: Omit<Group, 'id' | 'repos'>,
  repo: SuggestionRepo
) {
  const group = groups.get(id) ?? { id, ...fields, repos: [] };
  group.repos.push(repo);
  groups.set(id, group);
}

function groupByOwner(repos: SuggestionRepo[], login: string | null) {
  const groups = new Map<string, Group>();
  const loose: SuggestionRepo[] = [];
  for (const repo of repos) {
    const remote = readRemote(repo.remote);
    if (!remote) loose.push(repo);
    else if (remote.owner === login) addRepo(groups, PERSONAL_ID, { owner: null, stem: null }, repo);
    else addRepo(groups, `owner:${remote.owner}`, { owner: remote.owner, stem: null }, repo);
  }
  for (const group of [...groups.values()]) {
    if (group.id === PERSONAL_ID || group.repos.length >= MIN_OWNER_REPOS) continue;
    groups.delete(group.id);
    for (const repo of group.repos) addRepo(groups, PERSONAL_ID, { owner: null, stem: null }, repo);
  }
  return { groups, loose };
}

function splitStems(groups: Map<string, Group>) {
  for (const group of [...groups.values()]) {
    if (!group.owner) continue;
    const owner = resolveStem(resolveOwnerName(group.owner));
    const stems = new Map<string, SuggestionRepo[]>();
    for (const repo of group.repos) {
      const stem = resolveStem(readRemote(repo.remote)?.name ?? repo.name);
      stems.set(stem, [...(stems.get(stem) ?? []), repo]);
    }
    for (const [stem, repos] of stems) {
      const remotes = new Set(repos.map((repo) => readRemote(repo.remote)?.name));
      if (stem === owner || remotes.size < MIN_STEM_REMOTES || repos.length === group.repos.length) continue;
      group.repos = group.repos.filter((repo) => !repos.includes(repo));
      groups.set(`stem:${group.owner}/${stem}`, {
        id: `stem:${group.owner}/${stem}`,
        owner: group.owner,
        stem,
        repos,
      });
    }
  }
}

function selectStemGroup(groups: Map<string, Group>, repo: SuggestionRepo) {
  const stem = resolveStem(repo.name);
  for (const group of groups.values()) {
    const named = group.repos.some(
      (member) =>
        resolveStem(member.name) === stem || resolveStem(readRemote(member.remote)?.name ?? '') === stem
    );
    if (named) return group;
  }
  return null;
}

function selectFolderGroup(groups: Map<string, Group>, folder: string) {
  let best: Group | null = null;
  let total = 0;
  let most = 0;
  for (const group of groups.values()) {
    const count = group.repos.filter((repo) => resolveParent(repo.path) === folder).length;
    total += count;
    if (count > most) {
      best = group;
      most = count;
    }
  }
  if (!best || best.id === PERSONAL_ID || most < MIN_OWNER_REPOS || most / total < FOLDER_SHARE) return null;
  return best;
}

function placeLoose(groups: Map<string, Group>, loose: SuggestionRepo[]) {
  for (const repo of loose) {
    const group = selectStemGroup(groups, repo) ?? selectFolderGroup(groups, resolveParent(repo.path));
    if (group) group.repos.push(repo);
    else addRepo(groups, PERSONAL_ID, { owner: null, stem: null }, repo);
  }
}

function listGroupFolders(groups: Map<string, Group>, roots: string[]) {
  const folders = new Map<string, string[]>();
  for (const root of roots) {
    const group = selectFolderGroup(groups, root);
    if (group) folders.set(group.id, [...(folders.get(group.id) ?? []), root]);
  }
  return folders;
}

function isCovered(repo: SuggestionRepo, projects: Project[]) {
  return repo.projectId !== null || selectFolderProject(projects, repo.path) !== null;
}

function compareGroups(a: Group, b: Group) {
  if (a.id === PERSONAL_ID || b.id === PERSONAL_ID) return a.id === PERSONAL_ID ? 1 : -1;
  return b.repos.length - a.repos.length || a.id.localeCompare(b.id);
}

export function resolveProjectSuggestions(input: SuggestionInput): ProjectSuggestion[] {
  const login = input.login?.toLowerCase() ?? null;
  const fresh = input.repos.filter((repo) => !isCovered(repo, input.projects));
  const { groups, loose } = groupByOwner(fresh, login);
  splitStems(groups);
  placeLoose(groups, loose);
  const folders = listGroupFolders(groups, input.roots);
  const existing = new Map(input.projects.map((project) => [project.name.toLowerCase(), project]));
  const taken = input.projects.map((project) => project.key);
  return [...groups.values()].sort(compareGroups).map((group, index) => {
    const name = resolveGroupName(group);
    const project = existing.get(name.toLowerCase()) ?? null;
    const key = project?.key ?? resolveProjectKey(name, taken);
    taken.push(key);
    return {
      id: group.id,
      name: project?.name ?? name,
      key,
      color: project?.color ?? (PROJECT_COLORS[index % PROJECT_COLORS.length] as string),
      projectId: project?.id ?? null,
      folders: (folders.get(group.id) ?? []).filter((folder) => !project?.folders.includes(folder)),
      repos: group.repos
        .map((repo) => ({ path: repo.path, name: repo.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
