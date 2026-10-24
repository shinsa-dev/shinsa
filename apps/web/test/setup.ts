import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

const { afterEach } = await import('bun:test');
const { cleanup } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/');
  dispatchEvent(new PopStateEvent('popstate'));
});
