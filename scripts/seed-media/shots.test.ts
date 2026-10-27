import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  listShotFiles,
  OUTPUT_DIRS,
  resolveShotPath,
  resolveShotUrl,
  SEED_SHOTS,
  type SeedShot,
  serializeFrameList,
} from './shots.ts';

const ROOT = join(import.meta.dirname, '..', '..');

const FIXTURES = join(import.meta.dirname, 'fixtures');

function listMedia(dir: string) {
  return readdirSync(join(ROOT, dir))
    .filter((name) => /\.(png|webm)$/.test(name))
    .sort();
}

function findShot(file: string): SeedShot {
  const shot = SEED_SHOTS.find((entry) => entry.file === file);
  if (!shot) throw new Error(`No shot ${file}.`);
  return shot;
}

describe('the seed media shots', () => {
  test('cover every checked-in file, so each one can be taken again', () => {
    expect(listShotFiles('seed')).toEqual(listMedia(OUTPUT_DIRS.seed));
    expect(listShotFiles('samples')).toEqual(listMedia(OUTPUT_DIRS.samples));
  });

  test('open a fixture page that exists, with its state in the query', () => {
    for (const shot of SEED_SHOTS) {
      const url = resolveShotUrl(shot, FIXTURES, null);
      if (url) expect(existsSync(new URL(url).pathname)).toBe(true);
    }
    expect(resolveShotUrl(findShot('tabs-390-light-after.png'), '/fixtures', null)).toBe(
      'file:///fixtures/tabs.html?mode=after&theme=light&active=Win-back+offer'
    );
    expect(findShot('tabs-390-light-after.png').source).toMatchObject({ centreActive: true });
    expect(findShot('tabs-1280-light-after.png').source).not.toHaveProperty('centreActive');
  });

  test('take a shot of the app only against a running Shinsa', () => {
    const shot = findShot('review-spots-1280-dark-after.png');
    expect(resolveShotUrl(shot, FIXTURES, null)).toBeNull();
    expect(resolveShotUrl(shot, FIXTURES, 'http://127.0.0.1:5960')).toBe(
      'http://127.0.0.1:5960/tasks/task-sample-review?tab=review'
    );
  });

  test('write the seed media beside the seed and the samples into the web app', () => {
    expect(resolveShotPath('/repo', findShot('tabs-scroll-1280-light.webm'))).toBe(
      '/repo/scripts/seed-media/tabs-scroll-1280-light.webm'
    );
    expect(resolveShotPath('/repo', findShot('tabs-scroll.webm'))).toBe(
      '/repo/apps/web/public/samples/evidence/tabs-scroll.webm'
    );
  });
});

describe('serializeFrameList', () => {
  test('holds each frame until the next, the last until the end', () => {
    expect(
      serializeFrameList(
        [
          { path: '/f/0.jpg', at: 10 },
          { path: '/f/1.jpg', at: 10.5 },
        ],
        12
      )
    ).toBe("file '/f/0.jpg'\nduration 0.500\nfile '/f/1.jpg'\nduration 1.500\nfile '/f/1.jpg'\n");
    expect(serializeFrameList([{ path: '/f/0.jpg', at: 10 }], 9)).toContain('duration 0.000');
  });

  test('refuses a recording without frames', () => {
    expect(() => serializeFrameList([], 1)).toThrow('The recording has no frames.');
  });
});
