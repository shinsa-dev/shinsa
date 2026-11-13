import { Option } from 'effect';
import type { GateGitHubSso, Task } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';

const SAML_REFUSAL = /SAML (?:enforcement|SSO)/i;

const AUTHORIZATION_LINK = /https:\/\/github\.com\/orgs\/([\w.-]+)\/sso\?authorization_request=[\w-]+/;

const NAMED_ORGANIZATION = /The [`'‘"]([\w.-]+)[`'’"] organization/;

const GITHUB_OWNER = /github\.com[:/]([\w.-]+)\//;

function parseNamedOrganization(detail: string) {
  return Option.fromNullishOr(NAMED_ORGANIZATION.exec(detail)?.[1]);
}

function parseGitHubOwner(url: string) {
  return Option.fromNullishOr(GITHUB_OWNER.exec(url)?.[1]);
}

export function parseGitHubSso(detail: string, owner: Option.Option<string>): Option.Option<GateGitHubSso> {
  if (!SAML_REFUSAL.test(detail)) return Option.none();
  const link = AUTHORIZATION_LINK.exec(detail);
  if (link) return Option.some({ organization: link[1] ?? null, url: link[0] });
  const organization = Option.getOrNull(Option.orElse(parseNamedOrganization(detail), () => owner));
  const url = organization
    ? `https://github.com/orgs/${organization}/sso`
    : 'https://github.com/settings/tokens';
  return Option.some({ organization, url });
}

export function resolveTaskGitHubOwner(state: Pick<ShinsaState, 'repos'>, task: Task) {
  const remote = task.repoId ? state.repos[task.repoId]?.remote : null;
  return Option.orElse(Option.flatMap(Option.fromNullishOr(task.pullRequest?.url), parseGitHubOwner), () =>
    Option.flatMap(Option.fromNullishOr(remote), parseGitHubOwner)
  );
}

function resolveTitle(sso: GateGitHubSso) {
  return sso.organization
    ? `GitHub needs SSO authorization for ${sso.organization}`
    : 'GitHub needs SSO authorization';
}

function resolveBody(sso: GateGitHubSso) {
  const organization = sso.organization ? `the ${sso.organization} organization` : 'this organization';
  if (sso.url.includes('authorization_request='))
    return `The GitHub login Shinsa uses is not authorized for ${organization}, which enforces SAML single sign-on. [Authorize it on GitHub](${sso.url}), then sign \`gh\` in again with \`gh auth refresh -h github.com\` in a terminal and retry.`;
  return `The GitHub token Shinsa uses is not authorized for ${organization}, which enforces SAML single sign-on. [Authorize the token for ${organization} on GitHub](${sso.url}), then retry.`;
}

export function resolveGitHubSsoGate(sso: GateGitHubSso) {
  return { title: resolveTitle(sso), body: resolveBody(sso), cause: 'github_sso' as const, githubSso: sso };
}
