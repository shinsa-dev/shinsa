import { describe, expect, test } from 'bun:test';
import {
  isShareFileId,
  isShareFileType,
  resolveMachineFilePath,
  resolveMachinePublicationPath,
  resolveMachinePublicationRemovePath,
  resolveShareFilePath,
  resolveSharePagePath,
  resolveSharePath,
  resolveSharePreviewApiPath,
  resolveSharePreviewDiffApiPath,
  resolveShareUrl,
  SHARE_DIFF_FILE,
} from '../../src/remote/shares.ts';

describe('the share contract', () => {
  test('names the machine routes a publication goes through', () => {
    expect(resolveMachinePublicationPath('task-1')).toBe('/__remote/machine/publications/task-1');
    expect(resolveMachinePublicationRemovePath('task-1')).toBe(
      '/__remote/machine/publications/task-1/remove'
    );
    expect(resolveMachineFilePath('ab12')).toBe('/__remote/machine/files/ab12');
  });

  test('names the public page, its data and its files by the share token', () => {
    expect(resolveSharePagePath('tok')).toBe('/share/tok');
    expect(resolveShareUrl('https://app.shinsa.dev', 'tok')).toBe('https://app.shinsa.dev/share/tok');
    expect(resolveSharePath('tok')).toBe('/__remote/shares/tok');
    expect(resolveShareFilePath('tok', SHARE_DIFF_FILE)).toBe('/__remote/shares/tok/files/diff');
  });

  test('names the engine routes a preview reads', () => {
    expect(resolveSharePreviewApiPath('task 1')).toBe('/api/tasks/task%201/share/preview');
    expect(resolveSharePreviewDiffApiPath('task-1')).toBe('/api/tasks/task-1/share/preview/diff');
  });

  test('accepts only file types a page can show without running them', () => {
    expect(isShareFileType('image/png')).toBe(true);
    expect(isShareFileType('text/plain')).toBe(true);
    expect(isShareFileType('image/svg+xml')).toBe(false);
    expect(isShareFileType('text/html')).toBe(false);
  });

  test('accepts file ids that fit one path segment', () => {
    expect(isShareFileId('0192f-evidence_1')).toBe(true);
    expect(isShareFileId('../secret')).toBe(false);
    expect(isShareFileId('')).toBe(false);
  });
});
