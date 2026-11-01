import { describe, expect, test } from 'bun:test';
import { serializeLlms } from '../../src/lib/llms';

describe('serializeLlms', () => {
  test('links the canary as the Mac download and the beta after it', () => {
    const links = serializeLlms().split('## Links')[1] ?? '';

    expect(links).toContain('- [Download the canary for Mac](https://shinsa.dev/download/canary)');
    expect(links).toContain('- [Download the beta for Mac](https://shinsa.dev/download/beta)');
    expect(links.indexOf('/download/canary')).toBeLessThan(links.indexOf('/download/beta'));
    expect(links).not.toContain('https://shinsa.dev/download)');
  });
});
