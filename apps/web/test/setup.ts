import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

const { afterEach } = await import('bun:test');
const { cleanup } = await import('@testing-library/react');
const { toast } = await import('@shinsa/ui/components/sonner');
const { resetTaskDrafts } = await import('@/lib/chat/task-drafts.ts');
const { resetHighlights } = await import('@/lib/code/highlight.ts');
const { resetAgentProviders } = await import('@/lib/connection/models.ts');
const { resetRemoteAccess } = await import('@/lib/connection/remote-access.ts');
const { connection } = await import('@/lib/connection/socket.ts');
const { resetEvidenceTexts } = await import('@/lib/evidence/texts.ts');
const { resetDisclosures } = await import('@/lib/preferences/disclosure.ts');
const { replaceSharedHandles } = await import('@/router.ts');
const { runTeardowns } = await import('./support/teardown.ts');
const { restoreRealTimers } = await import('./support/timers.ts');

afterEach(() => {
  restoreRealTimers();
  runTeardowns();
  cleanup();
  toast.dismiss();
  connection.reset();
  resetHighlights();
  resetTaskDrafts();
  resetEvidenceTexts();
  resetAgentProviders();
  resetRemoteAccess();
  localStorage.clear();
  resetDisclosures();
  replaceSharedHandles(new Set());
  history.replaceState(null, '', '/');
  dispatchEvent(new PopStateEvent('popstate'));
});
