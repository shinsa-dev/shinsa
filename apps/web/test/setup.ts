import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

const { afterEach } = await import('bun:test');
const { cleanup } = await import('@testing-library/react');
const { resetDisclosures } = await import('@/lib/preferences/disclosure.ts');

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetDisclosures();
  history.replaceState(null, '', '/');
  dispatchEvent(new PopStateEvent('popstate'));
});
