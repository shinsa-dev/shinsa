import { GlobalRegistrator } from '@happy-dom/global-registrator';

const { AbortController, AbortSignal } = globalThis;
GlobalRegistrator.register();
Object.assign(globalThis, { AbortController, AbortSignal });

const { afterEach } = await import('bun:test');
const { cleanup } = await import('@testing-library/react');

afterEach(cleanup);
