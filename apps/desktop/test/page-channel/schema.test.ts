import { describe, expect, it } from 'bun:test';
import { Option, Schema } from 'effect';
import { CHANNELS } from '../../src/bridge/schema.ts';
import { PAGE_REQUEST_CHANNELS, PageRequest } from '../../src/page-channel/schema.ts';

const decode = Schema.decodeUnknownOption(PageRequest);

describe('the page’s requests', () => {
  it('takes a machine to pin, or none to choose one, and nothing else', () => {
    expect(decode({ channel: CHANNELS.useMachine, payload: { id: 'm1', name: 'Studio' } })).toEqual(
      Option.some({ channel: CHANNELS.useMachine, payload: { id: 'm1', name: 'Studio' } })
    );
    expect(decode({ channel: CHANNELS.useMachine, payload: null })).toEqual(
      Option.some({ channel: CHANNELS.useMachine, payload: null })
    );
    expect(Option.isNone(decode({ channel: CHANNELS.useMachine, payload: { id: 'm1' } }))).toBe(true);
    expect(
      Option.isNone(decode({ channel: CHANNELS.useMachine, payload: { id: 'm1', name: 'x'.repeat(81) } }))
    ).toBe(true);
  });

  it('listens on every channel it decodes', () => {
    expect(PAGE_REQUEST_CHANNELS).toContain(CHANNELS.signIn);
    expect(PAGE_REQUEST_CHANNELS).toContain(CHANNELS.useLocalEngine);
    expect(PAGE_REQUEST_CHANNELS).toContain(CHANNELS.useMachine);
  });
});
