import { describe, expect, it } from 'bun:test';
import {
  clampView,
  describeOpenImage,
  describeZoom,
  FIT,
  intersectBoxes,
  isLeavingHeld,
  isPastTapSlop,
  resolveCorners,
  resolveFit,
  resolveImageName,
  resolveKeyView,
  resolveLanding,
  resolveObjectBox,
  resolvePanView,
  resolvePinch,
  resolvePinchView,
  resolveShownSize,
  resolveStagePoint,
  resolveStepIndex,
  resolveSwap,
  resolveSwapMotion,
  resolveTapView,
  resolveViewerItem,
  resolveViewLanding,
  resolveWheelView,
  resolveZoomRange,
  serializeLanding,
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

describe('resolveShownSize', () => {
  it('shows a shot taken at twice the scale at the width it was taken at, so each CSS pixel keeps two', () => {
    expect(resolveShownSize({ width: 2560, height: 1600 }, 1280)).toEqual({ width: 1280, height: 800 });
    expect(resolveShownSize({ width: 1170, height: 2532 }, 390)).toEqual({ width: 390, height: 844 });
  });

  it('keeps the natural size without a width, or when the file is no wider than it', () => {
    expect(resolveShownSize({ width: 1280, height: 800 }, null)).toEqual({ width: 1280, height: 800 });
    expect(resolveShownSize({ width: 1280, height: 800 }, undefined)).toEqual({ width: 1280, height: 800 });
    expect(resolveShownSize({ width: 1280, height: 800 }, 1280)).toEqual({ width: 1280, height: 800 });
    expect(resolveShownSize({ width: 900, height: 860 }, 1280)).toEqual({ width: 900, height: 860 });
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

describe('resolveObjectBox', () => {
  const box = { left: 10, top: 20, width: 200, height: 100 };
  const natural = { width: 400, height: 400 };

  it('letterboxes a contained image in the middle of its box, the default too', () => {
    const contained = { left: 60, top: 20, width: 100, height: 100 };
    expect(resolveObjectBox(box, natural, 'contain')).toEqual(contained);
    expect(resolveObjectBox(box, natural, '')).toEqual(contained);
  });

  it('overflows the box for a covering image, so the box crops it', () => {
    expect(resolveObjectBox(box, natural, 'cover')).toEqual({ left: 10, top: -30, width: 200, height: 200 });
  });

  it('stretches to the box for fill', () => {
    expect(resolveObjectBox(box, natural, 'fill')).toBe(box);
  });

  it('keeps the natural size for none, and never grows it for scale-down', () => {
    const small = { width: 40, height: 20 };
    expect(resolveObjectBox(box, natural, 'none')).toEqual({ left: -90, top: -130, width: 400, height: 400 });
    expect(resolveObjectBox(box, small, 'scale-down')).toEqual({ left: 90, top: 60, width: 40, height: 20 });
    expect(resolveObjectBox(box, natural, 'scale-down')).toEqual({
      left: 60,
      top: 20,
      width: 100,
      height: 100,
    });
  });
});

describe('intersectBoxes', () => {
  it('returns the overlap of two boxes', () => {
    expect(
      intersectBoxes(
        { left: 0, top: 0, width: 100, height: 100 },
        { left: 50, top: 60, width: 100, height: 100 }
      )
    ).toEqual({ left: 50, top: 60, width: 50, height: 40 });
  });

  it('returns null when the boxes only touch or miss', () => {
    const first = { left: 0, top: 0, width: 100, height: 100 };
    expect(intersectBoxes(first, { left: 100, top: 0, width: 10, height: 10 })).toBeNull();
    expect(intersectBoxes(first, { left: 0, top: 100, width: 10, height: 10 })).toBeNull();
  });
});

describe('resolveCorners', () => {
  it('rounds a corner by the largest radius among the clips whose same corner it sits on', () => {
    const visible = { left: 0, top: 0, width: 100, height: 50 };
    const card = { box: { left: 0, top: 0, width: 100, height: 80 }, radius: 8 };
    const image = { box: { left: 0.2, top: -0.2, width: 99.6, height: 50.3 }, radius: 4 };
    expect(resolveCorners(visible, [card, image])).toEqual([8, 8, 4, 4]);
  });

  it('leaves a corner square when it touches no clip corner', () => {
    expect(resolveCorners({ left: 10, top: 10, width: 10, height: 10 }, [])).toEqual([0, 0, 0, 0]);
  });
});

describe('resolveViewLanding', () => {
  it('lands on the view with no crop and one radius at every corner', () => {
    expect(resolveViewLanding({ scale: 2, x: 5, y: 6 }, 8)).toEqual({
      view: { scale: 2, x: 5, y: 6 },
      clip: { top: 0, right: 0, bottom: 0, left: 0 },
      corners: [8, 8, 8, 8],
    });
  });
});

describe('resolveLanding', () => {
  const natural = { width: 1600, height: 800 };
  const fitted = { width: 800, height: 400 };

  it('moves and shrinks the fitted image onto the image a contained thumbnail draws, keeping its aspect', () => {
    const thumbnail = {
      box: { left: 100, top: 50, width: 80, height: 60 },
      objectFit: 'contain',
      radius: 0,
      clips: [{ box: { left: 100, top: 50, width: 80, height: 60 }, radius: 8 }],
    };
    expect(resolveLanding(thumbnail, natural, fitted, VIEWPORT)).toEqual({
      view: { scale: 0.1, x: -360, y: -334 },
      clip: { top: 0, right: 0, bottom: 0, left: 0 },
      corners: [0, 0, 0, 0],
    });
  });

  it('crops to a covering thumbnail and takes its corners, in the image own pixels', () => {
    const thumbnail = {
      box: { left: 100, top: 100, width: 100, height: 100 },
      objectFit: 'cover',
      radius: 10,
      clips: [],
    };
    expect(resolveLanding(thumbnail, natural, fitted, VIEWPORT)).toEqual({
      view: { scale: 0.25, x: -350, y: -264 },
      clip: { top: 0, right: 200, bottom: 0, left: 200 },
      corners: [40, 40, 40, 40],
    });
  });

  it('crops to the part a scrolling parent and the window still show', () => {
    const thumbnail = {
      box: { left: 900, top: -20, width: 200, height: 100 },
      objectFit: 'fill',
      radius: 0,
      clips: [{ box: { left: 0, top: 0, width: 2000, height: 2000 }, radius: 0 }],
    };
    expect(resolveLanding(thumbnail, natural, fitted, VIEWPORT)).toEqual({
      view: { scale: 0.25, x: 500, y: -384 },
      clip: { top: 80, right: 400, bottom: 0, left: 0 },
      corners: [0, 0, 0, 0],
    });
  });

  it('has nowhere to land when the thumbnail is gone, empty or scrolled out of view', () => {
    const thumbnail = {
      box: { left: 0, top: 0, width: 80, height: 40 },
      objectFit: 'contain',
      radius: 0,
      clips: [],
    };
    expect(
      resolveLanding({ ...thumbnail, box: { ...thumbnail.box, width: 0 } }, natural, fitted, VIEWPORT)
    ).toBeNull();
    expect(
      resolveLanding({ ...thumbnail, box: { ...thumbnail.box, height: 0 } }, natural, fitted, VIEWPORT)
    ).toBeNull();
    expect(
      resolveLanding({ ...thumbnail, box: { ...thumbnail.box, top: -400 } }, natural, fitted, VIEWPORT)
    ).toBeNull();
    const hidden = { box: { left: 0, top: 500, width: 10, height: 10 }, radius: 0 };
    expect(resolveLanding({ ...thumbnail, clips: [hidden] }, natural, fitted, VIEWPORT)).toBeNull();
  });
});

describe('serializeLanding', () => {
  it('writes the landing as a transform and a rounded inset clip', () => {
    expect(
      serializeLanding({
        view: { scale: 0.5, x: -10, y: 20 },
        clip: { top: 1, right: 2, bottom: 3, left: 4 },
        corners: [8, 8, 0, 0],
      })
    ).toEqual({
      transform: 'translate(-10px, 20px) scale(0.5)',
      clipPath: 'inset(1px 2px 3px 4px round 8px 8px 0px 0px)',
    });
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

describe('resolveViewerItem', () => {
  const images = [
    { item: 'settings', part: 'Before' },
    { item: 'settings', part: 'After' },
    {},
    { item: 'tabs', part: 'After' },
    { item: 'states', part: 'Empty' },
    { item: 'states', part: 'Loading' },
    { item: 'states' },
  ];

  it('counts items, not images, and lists the named parts of the one shown', () => {
    expect(resolveViewerItem(images, 1)).toEqual({
      position: 1,
      count: 4,
      parts: [
        { index: 0, name: 'Before' },
        { index: 1, name: 'After' },
      ],
    });
    expect(resolveViewerItem(images, 2)).toEqual({ position: 2, count: 4, parts: [] });
    expect(resolveViewerItem(images, 3)).toEqual({ position: 3, count: 4, parts: [] });
    expect(resolveViewerItem(images, 6)).toEqual({
      position: 4,
      count: 4,
      parts: [
        { index: 4, name: 'Empty' },
        { index: 5, name: 'Loading' },
      ],
    });
  });

  it('reads plain images as one item each', () => {
    expect(resolveViewerItem([{}, {}], 1)).toEqual({ position: 2, count: 2, parts: [] });
  });
});

describe('describeZoom', () => {
  it('says the zoom against the image’s actual size', () => {
    expect(describeZoom(3, 1.5)).toBe('200%');
  });
});

describe('resolveSwap', () => {
  const images = [{ item: 'settings' }, { item: 'settings' }, { item: 'recording' }, {}, {}];

  it('switches parts in place inside one comparison', () => {
    expect(resolveSwap(images, 0, 1, 1)).toEqual({ kind: 'part', direction: 1 });
    expect(resolveSwap(images, 1, 0, -1)).toEqual({ kind: 'part', direction: -1 });
  });

  it('steps between items in the direction of travel', () => {
    expect(resolveSwap(images, 1, 2, 1)).toEqual({ kind: 'step', direction: 1 });
    expect(resolveSwap(images, 0, 4, -1)).toEqual({ kind: 'step', direction: -1 });
  });

  it('steps between images that belong to no item', () => {
    expect(resolveSwap(images, 3, 4, 1)).toEqual({ kind: 'step', direction: 1 });
  });
});

describe('resolveSwapMotion', () => {
  it('slides a step 10px toward its direction over 200ms', () => {
    expect(resolveSwapMotion({ kind: 'step', direction: 1 }, false)).toEqual({
      duration: 200,
      enter: 10,
      leave: -10,
    });
    expect(resolveSwapMotion({ kind: 'step', direction: -1 }, false)).toEqual({
      duration: 200,
      enter: -10,
      leave: 10,
    });
  });

  it('crossfades a part in place over 150ms', () => {
    expect(resolveSwapMotion({ kind: 'part', direction: 1 }, false)).toEqual({
      duration: 150,
      enter: 0,
      leave: 0,
    });
  });

  it('only fades under reduced motion', () => {
    expect(resolveSwapMotion({ kind: 'step', direction: 1 }, true)).toEqual({
      duration: 150,
      enter: 0,
      leave: 0,
    });
  });
});

describe('isLeavingHeld', () => {
  const size = { width: 800, height: 500 };
  const part = { kind: 'part', direction: 1 } as const;

  it('holds the leaving part under the entering one when they share a rect', () => {
    expect(isLeavingHeld(part, size, { width: 800.2, height: 500 })).toBe(true);
  });

  it('fades the leaving image out when the rects differ', () => {
    expect(isLeavingHeld(part, size, { width: 800, height: 600 })).toBe(false);
    expect(isLeavingHeld(part, size, { width: 700, height: 500 })).toBe(false);
  });

  it('fades out on a step and when a size is not known', () => {
    expect(isLeavingHeld({ kind: 'step', direction: 1 }, size, size)).toBe(false);
    expect(isLeavingHeld(part, null, size)).toBe(false);
    expect(isLeavingHeld(part, size, null)).toBe(false);
  });
});
