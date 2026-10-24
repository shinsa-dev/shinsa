import { describe, expect, it } from 'bun:test';
import {
  clampView,
  describeOpenImage,
  describeZoom,
  FIT,
  isPastTapSlop,
  resolveFit,
  resolveImageName,
  resolveKeyView,
  resolveOriginTransform,
  resolvePanView,
  resolvePinch,
  resolvePinchView,
  resolveStagePoint,
  resolveStepIndex,
  resolveTapView,
  resolveWheelView,
  resolveZoomRange,
  zoomAround,
} from '@/lib/image-view.ts';

const VIEWPORT = { width: 1000, height: 828 };

describe('describeOpenImage', () => {
  it('names the image by its caption, else by its file name', () => {
    expect(describeOpenImage({ src: '/api/evidence/a.png', caption: 'Login screen' })).toBe(
      'Open Login screen'
    );
    expect(describeOpenImage({ src: '/api/evidence/a.png', caption: '' })).toBe('Open a.png');
    expect(describeOpenImage({ src: '/api/evidence/a.png' })).toBe('Open a.png');
  });
});

describe('resolveImageName', () => {
  it('takes the decoded file name from a path or URL', () => {
    expect(resolveImageName('/api/evidence/Login%20screen.png')).toBe('Login screen.png');
    expect(resolveImageName('https://example.com/shots/home.png?width=200#top')).toBe('home.png');
    expect(resolveImageName('https://example.com/shots/')).toBe('shots');
  });

  it('keeps a name it cannot decode as it is', () => {
    expect(resolveImageName('/media/100%.png')).toBe('100%.png');
  });

  it('calls inline and nameless images just Image', () => {
    expect(resolveImageName('data:image/png;base64,AAAA')).toBe('Image');
    expect(resolveImageName('blob:http://localhost/123')).toBe('Image');
    expect(resolveImageName('?size=2')).toBe('Image');
    expect(resolveImageName('')).toBe('Image');
  });
});

describe('resolveFit', () => {
  it('keeps a positive size in a window shorter than the viewer chrome', () => {
    const fit = resolveFit({ width: 400, height: 400 }, { width: 300, height: 100 }, 24);
    expect(fit?.width).toBeGreaterThan(0);
    expect(fit?.actual).toBeGreaterThan(1);
  });

  it('waits until the image size is known', () => {
    expect(resolveFit(null, VIEWPORT, 24)).toBeNull();
  });

  it('never upscales an image that already fits', () => {
    expect(resolveFit({ width: 400, height: 300 }, VIEWPORT, 24)).toEqual({
      width: 400,
      height: 300,
      actual: 1,
    });
  });

  it('shrinks a large image into the room left by the gutters and the chrome', () => {
    expect(resolveFit({ width: 1904, height: 500 }, VIEWPORT, 24)).toEqual({
      width: 952,
      height: 250,
      actual: 2,
    });
    expect(resolveFit({ width: 1000, height: 1400 }, VIEWPORT, 24)).toEqual({
      width: 500,
      height: 700,
      actual: 2,
    });
  });
});

describe('clampView', () => {
  const fitted = { width: 800, height: 600 };

  it('snaps back to the fitted view at or below fit', () => {
    expect(clampView({ scale: 1, x: 50, y: 20 }, fitted, VIEWPORT)).toBe(FIT);
    expect(clampView({ scale: 0.5, x: 0, y: 0 }, fitted, VIEWPORT)).toBe(FIT);
  });

  it('lets a zoomed image pan only until its edge plus a margin shows', () => {
    expect(clampView({ scale: 2, x: 5000, y: -5000 }, fitted, VIEWPORT)).toEqual({
      scale: 2,
      x: 332,
      y: -218,
    });
    expect(clampView({ scale: 2, x: 100, y: 50 }, fitted, VIEWPORT)).toEqual({ scale: 2, x: 100, y: 50 });
  });

  it('holds a zoomed image that is still smaller than the window in place', () => {
    const view = clampView({ scale: 1.5, x: 80, y: -80 }, { width: 300, height: 200 }, VIEWPORT);
    expect([view.scale, view.x + 0, view.y + 0]).toEqual([1.5, 0, 0]);
  });
});

describe('zoomAround', () => {
  it('keeps the point under the pointer still while zooming', () => {
    const view = { scale: 1, x: 0, y: 0 };
    const point = { x: 200, y: -100 };
    const zoomed = zoomAround(view, 2, point);
    expect(zoomed).toEqual({ scale: 2, x: -200, y: 100 });
    expect((point.x - zoomed.x) / zoomed.scale).toBe((point.x - view.x) / view.scale);
  });

  it('zooms out toward the same point', () => {
    expect(zoomAround({ scale: 4, x: -300, y: 60 }, 2, { x: 100, y: 20 })).toEqual({
      scale: 2,
      x: -100,
      y: 40,
    });
  });
});

describe('resolveOriginTransform', () => {
  it('moves and shrinks the fitted image onto its thumbnail', () => {
    const rect = { left: 100, top: 50, width: 80, height: 60 } as DOMRect;
    expect(resolveOriginTransform(rect, { width: 800, height: 400 }, VIEWPORT)).toBe(
      'translate(-360px, -334px) scale(0.1)'
    );
  });
});

describe('resolveStagePoint', () => {
  it('measures a point from the middle of the window', () => {
    expect(resolveStagePoint({ x: 600, y: 414 }, VIEWPORT)).toEqual({ x: 100, y: 0 });
  });
});

describe('resolveZoomRange', () => {
  it('zooms a tap to actual size, at least twice, and allows twice that', () => {
    expect(resolveZoomRange({ actual: 3 })).toEqual({ target: 3, max: 6 });
    expect(resolveZoomRange({ actual: 1 })).toEqual({ target: 2, max: 4 });
    expect(resolveZoomRange(null)).toEqual({ target: 2, max: 4 });
  });
});

describe('resolveWheelView', () => {
  it('zooms in on a wheel up, faster with Ctrl held, within the range', () => {
    const slow = resolveWheelView(FIT, { deltaY: -100, ctrlKey: false }, { x: 0, y: 0 }, 4);
    const fast = resolveWheelView(FIT, { deltaY: -100, ctrlKey: true }, { x: 0, y: 0 }, 4);
    expect(slow.scale).toBeCloseTo(Math.exp(0.2));
    expect(fast.scale).toBeCloseTo(Math.exp(1));
    expect(resolveWheelView(FIT, { deltaY: -1000, ctrlKey: true }, { x: 0, y: 0 }, 4).scale).toBe(4);
    expect(resolveWheelView(FIT, { deltaY: 100, ctrlKey: false }, { x: 0, y: 0 }, 4).scale).toBe(1);
  });
});

describe('resolveKeyView', () => {
  const view = { scale: 2, x: 10, y: 0 };

  it('zooms in on + or =, out on -, back to fit on 0', () => {
    expect(resolveKeyView('+', view, 4)).toEqual({ scale: 3, x: 10, y: 0 });
    expect(resolveKeyView('=', view, 2.5)).toEqual({ scale: 2.5, x: 10, y: 0 });
    expect(resolveKeyView('-', { ...view, scale: 3 }, 4)).toEqual({ scale: 2, x: 10, y: 0 });
    expect(resolveKeyView('0', view, 4)).toBe(FIT);
  });

  it('leaves other keys alone', () => {
    expect(resolveKeyView('ArrowRight', view, 4)).toBeNull();
  });
});

describe('resolveTapView', () => {
  it('zooms in where you tap, and back to fit when already zoomed', () => {
    expect(resolveTapView(FIT, 2, { x: 50, y: 0 })).toEqual({ scale: 2, x: -50, y: 0 });
    expect(resolveTapView({ scale: 2, x: -50, y: 0 }, 2, { x: 0, y: 0 })).toBe(FIT);
  });
});

describe('pinching', () => {
  const start = [
    { x: 400, y: 414 },
    { x: 600, y: 414 },
  ];

  it('needs two fingers', () => {
    expect(resolvePinch([{ x: 0, y: 0 }], VIEWPORT)).toBeNull();
    expect(resolvePinchView(FIT, { distance: 200, mid: { x: 0, y: 0 } }, [{ x: 0, y: 0 }], 4)).toBeNull();
  });

  it('scales by how far the fingers spread, around where they started, within the range', () => {
    const pinch = resolvePinch(start, VIEWPORT);
    expect(pinch).toEqual({ distance: 200, mid: { x: 0, y: 0 } });
    if (!pinch) throw new Error('no pinch');
    const spread = [
      { x: 300, y: 414 },
      { x: 700, y: 414 },
    ];
    expect(resolvePinchView(FIT, pinch, spread, 4)?.scale).toBe(2);
    expect(resolvePinchView(FIT, pinch, spread, 1.5)?.scale).toBe(1.5);
  });
});

describe('dragging', () => {
  it('counts a move past a few pixels as a drag, not a tap', () => {
    expect(isPastTapSlop({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(isPastTapSlop({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
  });

  it('pans by how far the pointer moved', () => {
    expect(resolvePanView({ scale: 2, x: 10, y: 10 }, { x: 0, y: 0 }, { x: 30, y: -5 })).toEqual({
      scale: 2,
      x: 40,
      y: 5,
    });
  });
});

describe('resolveStepIndex', () => {
  it('wraps around both ends', () => {
    expect(resolveStepIndex(2, 1, 3)).toBe(0);
    expect(resolveStepIndex(0, -1, 3)).toBe(2);
  });
});

describe('describeZoom', () => {
  it('says the zoom against the image’s actual size', () => {
    expect(describeZoom(3, 1.5)).toBe('200%');
  });
});
