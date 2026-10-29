import { describe, expect, it } from 'bun:test';
import type { ProjectSuggestion } from '@shinsa/core';
import {
  createProjectDrafts,
  describeFiledSummary,
  describeProjectSummary,
  describeProjectsSubmit,
  isProjectsReady,
  resolveProjectChoices,
  resolveProjectsSignature,
  resolveToggledRepo,
  updateProjectDraft,
} from '@/lib/onboarding-projects.ts';

function suggestion(id: string, name: string, repos: string[], folders: string[] = []): ProjectSuggestion {
  return {
    id,
    name,
    key: name.slice(0, 3).toUpperCase(),
    color: 'blue',
    projectId: null,
    folders,
    repos: repos.map((repo) => ({ path: `/u/code/${repo}`, name: repo })),
  };
}

const PROJECTS = [
  suggestion('owner:acme', 'Acme', ['api', 'web', 'docs', 'site', 'cli'], ['/u/code']),
  suggestion('personal', 'Personal', ['notes']),
];

describe('the suggested projects you edit', () => {
  it('starts with every suggestion kept as Shinsa named it, so Continue creates them all', () => {
    const drafts = createProjectDrafts(PROJECTS);
    expect(drafts).toEqual([
      { id: 'owner:acme', name: 'Acme', included: true, excluded: [] },
      { id: 'personal', name: 'Personal', included: true, excluded: [] },
    ]);
    expect(describeProjectsSubmit(PROJECTS, drafts)).toBe('Create 2 projects');
    expect(resolveProjectChoices(PROJECTS, drafts)).toEqual([
      {
        id: 'owner:acme',
        name: 'Acme',
        repos: ['/u/code/api', '/u/code/web', '/u/code/docs', '/u/code/site', '/u/code/cli'],
      },
      { id: 'personal', name: 'Personal', repos: ['/u/code/notes'] },
    ]);
  });

  it('a rename is sent trimmed, an unticked project is left out and a repository can be dropped and kept again', () => {
    let drafts = createProjectDrafts(PROJECTS);
    drafts = updateProjectDraft(drafts, 'owner:acme', { name: ' Acme Corp ' });
    drafts = updateProjectDraft(drafts, 'personal', { included: false });
    const acme = drafts[0] as (typeof drafts)[number];
    drafts = updateProjectDraft(drafts, 'owner:acme', resolveToggledRepo(acme, '/u/code/web'));
    expect(resolveProjectChoices(PROJECTS, drafts)).toEqual([
      {
        id: 'owner:acme',
        name: 'Acme Corp',
        repos: ['/u/code/api', '/u/code/docs', '/u/code/site', '/u/code/cli'],
      },
    ]);
    expect(describeProjectsSubmit(PROJECTS, drafts)).toBe('Create the project');
    const dropped = drafts[0] as (typeof drafts)[number];
    expect(resolveToggledRepo(dropped, '/u/code/web')).toEqual({ excluded: [] });
  });

  it('a project with every repository dropped counts as left out, and none kept continues without projects', () => {
    let drafts = createProjectDrafts(PROJECTS);
    drafts = updateProjectDraft(drafts, 'personal', { excluded: ['/u/code/notes'] });
    drafts = updateProjectDraft(drafts, 'owner:acme', { included: false });
    expect(resolveProjectChoices(PROJECTS, drafts)).toEqual([]);
    expect(describeProjectsSubmit(PROJECTS, drafts)).toBe('Continue without projects');
    expect(isProjectsReady(PROJECTS, drafts)).toBe(true);
    expect(resolveProjectChoices(PROJECTS, [])).toEqual([]);
  });

  it('is not ready while a kept project has no name', () => {
    const drafts = updateProjectDraft(createProjectDrafts(PROJECTS), 'personal', { name: '  ' });
    expect(isProjectsReady(PROJECTS, drafts)).toBe(false);
    expect(isProjectsReady(PROJECTS, updateProjectDraft(drafts, 'personal', { included: false }))).toBe(true);
  });

  it('sums a project up with its count, its folder while it keeps every repository, and a few names', () => {
    const [acme, personal] = createProjectDrafts(PROJECTS) as [
      ReturnType<typeof createProjectDrafts>[number],
      ReturnType<typeof createProjectDrafts>[number],
    ];
    const [acmeProject, personalProject] = PROJECTS as [ProjectSuggestion, ProjectSuggestion];
    expect(describeProjectSummary(acmeProject, acme, '/u', true)).toBe(
      '5 repositories · ~/code · api, web, docs and 2 more'
    );
    expect(describeProjectSummary(acmeProject, acme, '/u', false)).toBe('5 repositories · ~/code');
    expect(describeProjectSummary(acmeProject, { ...acme, excluded: ['/u/code/api'] }, '/u', false)).toBe(
      '4 of 5 repositories'
    );
    expect(describeProjectSummary(personalProject, personal, '/u', true)).toBe('1 repository · notes');
  });

  it('names the suggestions by id, name and size, so a change in words gives fresh drafts', () => {
    const [acmeProject] = PROJECTS as [ProjectSuggestion];
    expect(resolveProjectsSignature(PROJECTS)).toBe('owner:acme:Acme:5|personal:Personal:1');
    expect(resolveProjectsSignature([{ ...acmeProject, name: 'Acme Corp' }])).toBe('owner:acme:Acme Corp:5');
    expect(describeFiledSummary(acmeProject, '/u')).toBe(
      '5 repositories · ~/code · api, web, docs and 2 more'
    );
  });
});
