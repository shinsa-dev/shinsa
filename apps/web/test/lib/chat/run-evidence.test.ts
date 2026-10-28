import { describe, expect, it } from 'bun:test';
import { resolveCallImages } from '@/lib/chat/run-evidence.ts';
import { createToolCall, readTool, shinsaTool } from '../../support/chat.ts';
import { createEvidence } from '../../support/state.ts';

describe('resolveCallImages', () => {
  const evidence = [
    createEvidence({ id: 'log', taskId: 't', title: 'Login page', uri: '/api/evidence/log.txt' }),
    createEvidence({
      id: 'shot',
      taskId: 't',
      title: 'Login page',
      uri: '/api/evidence/shot.PNG?v=2',
      width: 1280,
    }),
    createEvidence({ id: 'other', taskId: 't', title: 'Footer', uri: '/api/evidence/footer.png' }),
  ];

  it('shows the attached evidence image first, captioned with its title and at the width it was taken at', () => {
    const call = createToolCall(shinsaTool('attach_evidence', { title: 'Login page' }), {
      images: ['/api/evidence/result.png'],
    });
    expect(resolveCallImages(call, evidence)).toEqual([
      { src: '/api/evidence/shot.PNG?v=2', caption: 'Login page', width: 1280 },
      '/api/evidence/result.png',
    ]);
  });

  it('keeps only the result images when the evidence is not an image or not found', () => {
    const text = createToolCall(shinsaTool('attach_evidence', { title: 'Missing' }), { images: ['/a.png'] });
    expect(resolveCallImages(text, evidence)).toEqual(['/a.png']);
    const footer = createToolCall(shinsaTool('attach_evidence', { title: 'Footer' }));
    expect(resolveCallImages(footer, evidence)).toEqual([
      { src: '/api/evidence/footer.png', caption: 'Footer', width: null },
    ]);
    const untitled = createToolCall(shinsaTool('attach_evidence'));
    expect(resolveCallImages(untitled, evidence)).toEqual([]);
  });

  it('shows only the result images for any other tool', () => {
    const call = createToolCall(readTool('a.png'), { images: ['/api/evidence/a.png'] });
    expect(resolveCallImages(call, evidence)).toEqual(['/api/evidence/a.png']);
    const note = createToolCall(shinsaTool('note', { title: 'Login page' }));
    expect(resolveCallImages(note, evidence)).toEqual([]);
  });
});
