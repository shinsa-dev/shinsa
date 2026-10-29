import { describe, expect, test } from 'bun:test';
import { type Project, resolveProjectSuggestions, type SuggestionRepo } from '../../src/index.ts';

const DEV = '/u/Developer';

function repo(path: string, remote: string | null, projectId: string | null = null): SuggestionRepo {
  return { path, name: path.slice(path.lastIndexOf('/') + 1), remote, projectId };
}

function project(fields: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return {
    color: 'blue',
    key: fields.name.slice(0, 2).toUpperCase(),
    description: '',
    folders: [],
    ...fields,
  };
}

function summarize(input: Parameters<typeof resolveProjectSuggestions>[0]) {
  return resolveProjectSuggestions(input).map((suggestion) => ({
    name: suggestion.name,
    repos: suggestion.repos.map((entry) => entry.name),
    folders: suggestion.folders,
  }));
}

const MACHINE: SuggestionRepo[] = [
  repo(`${DEV}/Superwall/superwall`, 'github.com/superwall/superwall'),
  repo(`${DEV}/Superwall/pwn`, 'github.com/superwall/editor'),
  repo(`${DEV}/Superwall/docs`, 'github.com/superwall/docs'),
  repo(`${DEV}/Superwall/framework-tests`, null),
  repo(`${DEV}/Superwall/pws`, 'github.com/jane/screens'),
  repo(`${DEV}/Projects/buzzkit`, 'github.com/buzzkit-dev/buzzkit'),
  repo(`${DEV}/Projects/BuzzKit-iOS`, 'github.com/buzzkit-dev/buzzkit-ios'),
  repo(`${DEV}/Projects/cs`, 'github.com/north-studio/HarborLight'),
  repo(`${DEV}/Projects/csm`, 'github.com/north-studio/HarborLight-monitor'),
  repo(`${DEV}/Xcode/HarborLight`, 'github.com/north-studio/HarborLight-ios'),
  repo(`${DEV}/Projects/outpost`, 'github.com/north-studio/outpost'),
  repo(`${DEV}/Projects/machine`, 'github.com/north-studio/machine'),
  repo(`${DEV}/Projects/shinsa`, 'github.com/shinsa-dev/shinsa'),
  repo(`${DEV}/Projects/shinsa-old`, 'github.com/shinsa-dev/shinsa'),
  repo(`${DEV}/Projects/notes`, 'github.com/jane/notes'),
  repo(`${DEV}/Projects/notes-old`, null),
  repo(`${DEV}/Projects/forked`, 'github.com/someone/forked'),
  repo(`${DEV}/Projects/scratch`, null),
];

describe('project suggestions', () => {
  test('repositories group by owner, product and folder into the projects a person would make', () => {
    expect(
      summarize({
        roots: [`${DEV}/Superwall`, `${DEV}/Projects`],
        repos: MACHINE,
        login: 'jane',
        projects: [],
      })
    ).toEqual([
      {
        name: 'Superwall',
        repos: ['docs', 'framework-tests', 'pwn', 'superwall'],
        folders: [`${DEV}/Superwall`],
      },
      { name: 'HarborLight', repos: ['cs', 'csm', 'HarborLight'], folders: [] },
      { name: 'Buzzkit', repos: ['buzzkit', 'BuzzKit-iOS'], folders: [] },
      { name: 'North', repos: ['machine', 'outpost'], folders: [] },
      { name: 'Shinsa', repos: ['shinsa', 'shinsa-old'], folders: [] },
      { name: 'Personal', repos: ['forked', 'notes', 'notes-old', 'pws', 'scratch'], folders: [] },
    ]);
  });

  test('each suggestion gets a unique key, a colour and a stable id', () => {
    const suggestions = resolveProjectSuggestions({
      roots: [],
      repos: MACHINE,
      login: 'jane',
      projects: [project({ id: 'p1', name: 'Other', key: 'SUP' })],
    });
    const keys = suggestions.map((suggestion) => suggestion.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('SUP');
    expect(suggestions[0]).toMatchObject({
      id: 'owner:superwall',
      key: 'SU',
      color: 'blue',
      projectId: null,
    });
    expect(suggestions.find((suggestion) => suggestion.name === 'HarborLight')?.id).toStartWith(
      'stem:north-studio/'
    );
    expect(suggestions.at(-1)?.id).toBe('personal');
  });

  test('a repository already in a project, by its record or a project folder, is left out', () => {
    const suggestions = summarize({
      roots: [],
      repos: [
        repo('/code/a/one', 'github.com/acme/one', 'p1'),
        repo('/code/a/two', 'github.com/acme/two'),
        repo('/code/b/three', 'github.com/acme/three'),
        repo('/code/b/four', 'github.com/acme/four'),
      ],
      login: null,
      projects: [project({ id: 'p1', name: 'Mine', folders: ['/code/a'] })],
    });
    expect(suggestions).toEqual([{ name: 'Acme', repos: ['four', 'three'], folders: [] }]);
  });

  test('a suggestion named like an existing project adds to that project', () => {
    const [suggestion] = resolveProjectSuggestions({
      roots: ['/code/acme', '/code/kept'],
      repos: [repo('/code/acme/one', 'github.com/acme/one'), repo('/code/acme/two', 'github.com/acme/two')],
      login: null,
      projects: [project({ id: 'p9', name: 'ACME', key: 'AC', color: 'green', folders: ['/code/kept'] })],
    });
    expect(suggestion).toMatchObject({
      name: 'ACME',
      key: 'AC',
      color: 'green',
      projectId: 'p9',
      folders: ['/code/acme'],
    });
  });

  test('an owner with a single repository joins Personal, and so does a loose one nothing claims', () => {
    expect(
      summarize({
        roots: [],
        repos: [repo('/c/feedbase', 'github.com/FeedbaseHQ/feedbase'), repo('/c/scratch', null)],
        login: null,
        projects: [],
      })
    ).toEqual([{ name: 'Personal', repos: ['feedbase', 'scratch'], folders: [] }]);
  });

  test('without a GitHub login your own repositories are named after your account', () => {
    expect(
      summarize({
        roots: [],
        repos: [repo('/c/one', 'github.com/jane-doe/one'), repo('/c/two', 'gitlab.com/jane-doe/two.app')],
        login: null,
        projects: [],
      })
    ).toEqual([{ name: 'Jane Doe', repos: ['one', 'two'], folders: [] }]);
  });

  test('an owner suffix such as -dev, HQ or studio is dropped from the name', () => {
    const names = summarize({
      roots: [],
      repos: [
        repo('/c/a', 'github.com/buzzkit-dev/a'),
        repo('/c/b', 'github.com/buzzkit-dev/b'),
        repo('/c/c', 'github.com/AcmeHQ/c'),
        repo('/c/d', 'github.com/AcmeHQ/d'),
        repo('/c/e', 'github.com/studio/e'),
        repo('/c/f', 'github.com/studio/f'),
      ],
      login: null,
      projects: [],
    }).map((entry) => entry.name);
    expect(names).toEqual(['Acme', 'Buzzkit', 'Studio']);
  });

  test('a product splits off its owner only with three remotes of its own and not all of the owner', () => {
    const split = (names: string[]) =>
      summarize({
        roots: [],
        repos: names.map((name) => repo(`/c/${name}`, `github.com/acme/${name}`)),
        login: null,
        projects: [],
      }).map((entry) => entry.name);
    expect(split(['shop', 'shop-api', 'shop-ios', 'site'])).toEqual(['Shop', 'Acme']);
    expect(split(['shop', 'shop-api', 'site'])).toEqual(['Acme']);
    expect(split(['shop', 'shop-api', 'shop-ios'])).toEqual(['Acme']);
    expect(split(['acme', 'acme-api', 'acme-ios', 'site'])).toEqual(['Acme']);
  });

  test('a loose repository joins the project that holds most of its folder, never on a thin majority', () => {
    const repos = [
      repo('/c/work/one', 'github.com/acme/one'),
      repo('/c/work/two', 'github.com/acme/two'),
      repo('/c/work/three', 'github.com/beta/three'),
      repo('/c/work/four', 'github.com/beta/four'),
      repo('/c/work/loose', null),
    ];
    expect(summarize({ roots: ['/c/work'], repos, login: null, projects: [] })).toEqual([
      { name: 'Acme', repos: ['one', 'two'], folders: [] },
      { name: 'Beta', repos: ['four', 'three'], folders: [] },
      { name: 'Personal', repos: ['loose'], folders: [] },
    ]);
  });

  test('a remote without an owner and a name counts as no remote', () => {
    expect(
      summarize({ roots: ['/c'], repos: [repo('/c/odd', 'example.com/odd')], login: null, projects: [] })
    ).toEqual([{ name: 'Personal', repos: ['odd'], folders: [] }]);
  });
});
