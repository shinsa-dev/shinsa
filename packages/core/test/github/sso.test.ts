import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { parseGitHubSso, resolveGitHubSsoGate, resolveTaskGitHubOwner } from '../../src/github/index.ts';
import { createHarness, createTask } from '../harness.ts';

const LINK =
  'https://github.com/orgs/superwall/sso?authorization_request=APWSM3UGAEARXOT7A5UGXT3K64HHXA5PN5ZGOYLONF5GC5DJN5XF62LEZYCUVZVVVRX';

const GRAPHQL = `gh pr view failed: GraphQL: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization. (repository) Authorize in your web browser: ${LINK}`;

const REST =
  'gh api failed: Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization. (HTTP 403)';

const PUSH_WITH_LINK = `remote: The 'superwall' organization has enabled or enforced SAML SSO.\nremote: To access this repository, visit ${LINK} and try your request again.\nfatal: unable to access 'https://github.com/superwall/paywall-next.git/': The requested URL returned error: 403`;

const PUSH_WITH_TOKEN =
  "remote: The `acme' organization has enabled or enforced SAML SSO. To access\nremote: this repository, you must use the HTTPS remote with a personal access token or SSH with an SSH key and passphrase\nremote: that has been authorized for this organization.";

describe('reading a GitHub SSO refusal', () => {
  test('takes the organization and the exact link from the GraphQL error', () => {
    expect(parseGitHubSso(GRAPHQL, Option.some('other'))).toEqual(
      Option.some({ organization: 'superwall', url: LINK })
    );
  });

  test('takes the link from a refused push', () => {
    expect(parseGitHubSso(PUSH_WITH_LINK, Option.none())).toEqual(
      Option.some({ organization: 'superwall', url: LINK })
    );
  });

  test('names the organization from a push refused for a token, and links its SSO page', () => {
    expect(parseGitHubSso(PUSH_WITH_TOKEN, Option.some('other'))).toEqual(
      Option.some({ organization: 'acme', url: 'https://github.com/orgs/acme/sso' })
    );
  });

  test('falls back to the repository owner when the REST error names no organization', () => {
    expect(parseGitHubSso(REST, Option.some('superwall'))).toEqual(
      Option.some({ organization: 'superwall', url: 'https://github.com/orgs/superwall/sso' })
    );
  });

  test('links the token settings when no organization is known', () => {
    expect(parseGitHubSso(REST, Option.none())).toEqual(
      Option.some({ organization: null, url: 'https://github.com/settings/tokens' })
    );
  });

  test('leaves every other failure alone', () => {
    expect(parseGitHubSso('HTTP 502.', Option.some('superwall'))).toEqual(Option.none());
    expect(parseGitHubSso('API rate limit exceeded (HTTP 429)', Option.none())).toEqual(Option.none());
  });
});

describe('the SSO gate', () => {
  test('names the organization and asks to authorize the login with the link', () => {
    expect(resolveGitHubSsoGate({ organization: 'superwall', url: LINK })).toEqual({
      title: 'GitHub needs SSO authorization for superwall',
      body: `The GitHub login Shinsa uses is not authorized for the superwall organization, which enforces SAML single sign-on. [Authorize it on GitHub](${LINK}), then retry.`,
      cause: 'github_sso',
      githubSso: { organization: 'superwall', url: LINK },
    });
  });

  test('asks to authorize the token when GitHub gave no link', () => {
    const gate = resolveGitHubSsoGate({ organization: 'acme', url: 'https://github.com/orgs/acme/sso' });
    expect(gate.body).toBe(
      'The GitHub token Shinsa uses is not authorized for the acme organization, which enforces SAML single sign-on. [Authorize the token for the acme organization on GitHub](https://github.com/orgs/acme/sso), then retry.'
    );
  });

  test('speaks of this organization when none is known', () => {
    const gate = resolveGitHubSsoGate({ organization: null, url: 'https://github.com/settings/tokens' });
    expect(gate.title).toBe('GitHub needs SSO authorization');
    expect(gate.body).toContain('not authorized for this organization');
    expect(gate.body).toContain('(https://github.com/settings/tokens)');
  });
});

describe("a task's GitHub owner", () => {
  test('comes from the pull request, then the repository remote, else none', () => {
    const harness = createHarness();
    const task = harness.task(createTask(harness));
    expect(resolveTaskGitHubOwner(harness.state, task)).toEqual(Option.some('superwall'));
    const withPullRequest = {
      ...task,
      pullRequest: { url: 'https://github.com/acme/app/pull/1' },
    } as typeof task;
    expect(resolveTaskGitHubOwner(harness.state, withPullRequest)).toEqual(Option.some('acme'));
    expect(resolveTaskGitHubOwner(harness.state, { ...task, repoId: null })).toEqual(Option.none());
  });
});
