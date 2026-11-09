import { describe, expect, test } from 'bun:test';
import { createTargetFilter } from '../../src/browser/proxy/targets.ts';

const page = (targetId: string, openerId?: string) => ({
  targetId,
  type: 'page',
  url: 'about:blank',
  ...(openerId ? { openerId } : {}),
});

const attached = (sessionId: string, info: object, waitingForDebugger = false) =>
  JSON.stringify({
    method: 'Target.attachedToTarget',
    params: { sessionId, targetInfo: info, waitingForDebugger },
  });

const command = (id: number, method: string, params: object = {}, sessionId?: string) =>
  JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });

const parse = (texts: ReadonlyArray<string>) =>
  texts.map((text) => JSON.parse(text) as Record<string, unknown>);

describe('the page filter between an agent and the shared browser', () => {
  test('hides pages that were open before the agent connected and lets them run', () => {
    const filter = createTargetFilter();
    const other = filter.fromBrowser(attached('S-other', page('T-other'), true));
    expect(other.toAgent).toEqual([]);
    expect(parse(other.toBrowser)).toMatchObject([
      { method: 'Runtime.runIfWaitingForDebugger', sessionId: 'S-other' },
      { method: 'Target.detachFromTarget', params: { sessionId: 'S-other' } },
    ]);
    const [resumed, detached] = parse(other.toBrowser);
    expect(filter.fromBrowser(JSON.stringify({ id: resumed?.id, result: {} }))).toEqual({
      toAgent: [],
      toBrowser: [],
    });
    expect(filter.fromBrowser(JSON.stringify({ id: detached?.id, result: {} })).toAgent).toEqual([]);
    const gone = JSON.stringify({ method: 'Target.targetDestroyed', params: { targetId: 'T-other' } });
    expect(filter.fromBrowser(gone).toAgent).toEqual([]);
  });

  test('keeps the pages the agent opens, and the pages those open', () => {
    const filter = createTargetFilter();
    expect(filter.fromAgent(command(1, 'Target.createTarget', { url: 'about:blank' }))).toEqual({
      forward: command(1, 'Target.createTarget', { url: 'about:blank' }),
      reply: null,
    });
    const mine = attached('S-mine', page('T-mine'), true);
    const event = JSON.stringify({ method: 'Page.lifecycleEvent', params: {}, sessionId: 'S-mine' });
    expect(filter.fromBrowser(mine).toAgent).toEqual([]);
    expect(filter.fromBrowser(event).toAgent).toEqual([]);
    const created = JSON.stringify({ id: 1, result: { targetId: 'T-mine' } });
    expect(filter.fromBrowser(created)).toEqual({ toAgent: [mine, event, created], toBrowser: [] });
    const popup = attached('S-popup', page('T-popup', 'T-mine'));
    expect(filter.fromBrowser(popup).toAgent).toEqual([popup]);
    const changed = JSON.stringify({
      method: 'Target.targetInfoChanged',
      params: { targetInfo: page('T-popup') },
    });
    expect(filter.fromBrowser(changed).toAgent).toEqual([changed]);
  });

  test('lets go of another agent’s page that opened while its own was on the way', () => {
    const filter = createTargetFilter();
    filter.fromAgent(command(1, 'Target.createTarget', { url: 'about:blank' }));
    const created = JSON.stringify({ id: 1, result: { targetId: 'T-mine' } });
    expect(filter.fromBrowser(attached('S-other', page('T-other'), true)).toAgent).toEqual([]);
    const done = filter.fromBrowser(created);
    expect(done.toAgent).toEqual([created]);
    expect(parse(done.toBrowser).map((sent) => sent.method)).toEqual([
      'Runtime.runIfWaitingForDebugger',
      'Target.detachFromTarget',
    ]);
    const mine = attached('S-mine', page('T-mine'));
    expect(filter.fromBrowser(mine).toAgent).toEqual([mine]);
  });

  test('shows only the agent’s own pages in a list and refuses another agent’s page', () => {
    const filter = createTargetFilter();
    filter.fromBrowser(attached('S-other', page('T-other')));
    filter.fromAgent(command(1, 'Target.createTarget', { url: 'about:blank' }));
    filter.fromBrowser(JSON.stringify({ id: 1, result: { targetId: 'T-mine' } }));
    expect(filter.fromAgent(command(2, 'Target.getTargets')).forward).not.toBeNull();
    const worker = { targetId: 'T-worker', type: 'service_worker' };
    const listed = filter.fromBrowser(
      JSON.stringify({ id: 2, result: { targetInfos: [page('T-other'), page('T-mine'), worker, 'odd'] } })
    );
    expect(parse(listed.toAgent)[0]).toEqual({
      id: 2,
      result: { targetInfos: [page('T-mine'), worker, 'odd'] },
    });
    expect(
      parse([filter.fromAgent(command(3, 'Target.closeTarget', { targetId: 'T-other' })).reply ?? ''])
    ).toMatchObject([{ id: 3, error: { message: expect.stringContaining('another agent') } }]);
    expect(filter.fromAgent(command(4, 'Target.closeTarget', { targetId: 'T-mine' })).reply).toBeNull();
    const browserClose = filter.fromAgent(command(5, 'Browser.close'));
    expect(browserClose.forward).toBeNull();
    expect(browserClose.reply).toContain('"id":5');
  });

  test('passes everything else through untouched', () => {
    const filter = createTargetFilter();
    const worker = attached('S-worker', { targetId: 'T-worker', type: 'service_worker' });
    expect(filter.fromBrowser(worker).toAgent).toEqual([worker]);
    expect(filter.fromBrowser('not json').toAgent).toEqual(['not json']);
    const odd = JSON.stringify({ method: 'Target.attachedToTarget', params: { sessionId: 1 } });
    expect(filter.fromBrowser(odd).toAgent).toEqual([odd]);
    const unseen = JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: page('T-new') } });
    expect(filter.fromBrowser(unseen).toAgent).toEqual([]);
    const sessionEvent = JSON.stringify({
      method: 'Runtime.consoleAPICalled',
      params: {},
      sessionId: 'S-worker',
    });
    expect(filter.fromBrowser(sessionEvent).toAgent).toEqual([sessionEvent]);
    const plain = JSON.stringify({ method: 'Target.targetDestroyed', params: {} });
    expect(filter.fromBrowser(plain).toAgent).toEqual([plain]);
    const listed = JSON.stringify({ id: 9, result: { nope: true } });
    filter.fromAgent(command(9, 'Target.getTargets'));
    expect(filter.fromBrowser(listed).toAgent).toEqual([listed]);
    const session = command(10, 'Target.getTargets', {}, 'S-worker');
    expect(filter.fromAgent(session)).toEqual({ forward: session, reply: null });
    expect(filter.fromAgent('{"method":"Target.x"')).toEqual({
      forward: '{"method":"Target.x"',
      reply: null,
    });
    expect(filter.fromAgent(command(11, 'Page.navigate'))).toEqual({
      forward: command(11, 'Page.navigate'),
      reply: null,
    });
    filter.fromAgent(command(12, 'Target.createTarget'));
    const failed = JSON.stringify({ id: 12, error: { message: 'no' } });
    expect(filter.fromBrowser(failed)).toEqual({ toAgent: [failed], toBrowser: [] });
  });
});
