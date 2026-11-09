export const PROJECT_NOT_FOUND = {
  code: 'project_not_found',
  message: 'There is no project with that id.',
} as const;

export const SOURCE_INVALID = {
  code: 'browser_source_invalid',
  message: 'Name a browser to copy from: dia, arc, chrome, brave or edge.',
} as const;

export const SITES_INVALID = {
  code: 'browser_sites_invalid',
  message: 'Pick at least one site to copy, as a list of site names.',
} as const;

export const URL_INVALID = {
  code: 'browser_url_invalid',
  message: 'The sign-in page must be an http or https address.',
} as const;

export const KEYCHAIN_REFUSED_CODE = 'keychain_refused';

export const BROWSER_FAILED_CODE = 'browser_failed';

export const MAX_COPY_SITES = 500;

export const MAX_SITE_LENGTH = 253;
