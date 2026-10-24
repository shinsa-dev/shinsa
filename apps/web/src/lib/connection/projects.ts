import type { Project, Repo } from '@shinsa/core';
import { requestJson } from '@/lib/connection/http.ts';

export interface LocalRepo {
  path: string;
  name: string;
  repoId: string | null;
  projectId: string | null;
}

function resolveProjectPath(projectId: string, part: 'repos' | 'folders') {
  return `/api/projects/${encodeURIComponent(projectId)}/${part}`;
}

export async function requestLocalRepos() {
  const answer = await requestJson<{ repos: LocalRepo[] }>('/api/repos/local');
  return answer.repos;
}

export async function requestAddProjectRepo(projectId: string, path: string) {
  const answer = await requestJson<{ repo: Repo }>(resolveProjectPath(projectId, 'repos'), { path });
  return answer.repo;
}

export async function requestAddProjectFolder(projectId: string, path: string) {
  const answer = await requestJson<{ project: Project }>(resolveProjectPath(projectId, 'folders'), { path });
  return answer.project;
}
