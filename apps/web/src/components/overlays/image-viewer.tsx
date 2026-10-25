import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import type { useImageViewer, ViewerImage } from '@/hooks/use-image-viewer.ts';
import {
  clampView,
  describeZoom,
  FIT,
  isPastTapSlop,
  type Point,
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
  type Size,
  type View,
} from '@/lib/image-view.ts';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MORPH_MS = 320;
const DOUBLE_TAP_MS = 300;

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useViewport() {
  const [size, setSize] = React.useState<Size>(() => ({ width: innerWidth, height: innerHeight }));
  React.useEffect(() => {
    const update = () => setSize({ width: innerWidth, height: innerHeight });
    addEventListener('resize', update);
    return () => removeEventListener('resize', update);
  }, []);
  return size;
}

function ChromeButton({
  label,
  shortcut,
  onClick,
  className,
  children,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <button
        type='button'
        aria-label={label}
        onClick={onClick}
        className={cn(
          'pointer-events-auto grid size-9 cursor-pointer place-items-center rounded-full bg-white/10 text-white outline-none backdrop-blur-md hover:bg-white/20 active:scale-95 active:bg-white/20',
          className
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

function ImageViewerDialog({
  images,
  index,
  onIndexChange,
  onClose,
  resolveOrigin,
}: {
  images: ViewerImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  resolveOrigin: (index: number) => HTMLElement | null;
}) {
  const image = images[index];
  const many = images.length > 1;
  const viewport = useViewport();
  const [measured, setMeasured] = React.useState<{ src: string; size: Size } | null>(null);
  const [view, setView] = React.useState<View>(FIT);
  const [smooth, setSmooth] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);
  const backdrop = React.useRef<HTMLDivElement>(null);
  const shown = React.useRef<string | null>(null);
  const pointers = React.useRef(new Map<number, Point>());
  const gesture = React.useRef<{
    start: Point;
    view: View;
    moved: boolean;
    pinch: { distance: number; mid: Point } | null;
  } | null>(null);
  const lastTap = React.useRef(0);

  const natural = image && measured?.src === image.src ? measured.size : null;
  const fit = resolveFit(natural, viewport, many ? 72 : 24);
  const fitted = fit ? { width: fit.width, height: fit.height } : null;
  const { target, max: maxScale } = resolveZoomRange(fit);
  const toStage = (clientX: number, clientY: number) =>
    resolveStagePoint({ x: clientX, y: clientY }, viewport);

  const applyView = React.useCallback(
    (next: View, animate: boolean) => {
      if (!fitted) return;
      setSmooth(animate && !prefersReducedMotion());
      setView(clampView(next, fitted, viewport));
    },
    [fitted, viewport]
  );

  React.useEffect(() => {
    setView(FIT);
  }, [index]);

  React.useEffect(() => {
    const origin = resolveOrigin(index);
    if (!origin) return;
    origin.style.visibility = 'hidden';
    return () => {
      origin.style.visibility = '';
    };
  }, [index, resolveOrigin]);

  React.useLayoutEffect(() => {
    const element = frame.current;
    if (!fit || !element || !image || shown.current === image.src) return;
    const first = shown.current === null;
    shown.current = image.src;
    const reduce = prefersReducedMotion();
    if (!first) {
      if (!reduce) element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      return;
    }
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: reduce ? 0 : 220,
      easing: 'ease-out',
    });
    if (reduce) return;
    const rect = resolveOrigin(index)?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      element.animate(
        [
          { opacity: 0, transform: 'scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 220, easing: EASE }
      );
      return;
    }
    element.animate([{ transform: resolveOriginTransform(rect, fit, viewport) }, { transform: 'none' }], {
      duration: MORPH_MS,
      easing: EASE,
    });
  });

  function measure(element: HTMLImageElement) {
    const src = element.getAttribute('src') ?? '';
    if (measured?.src === src) return;
    setMeasured({ src, size: { width: element.naturalWidth, height: element.naturalHeight } });
  }

  function requestClose() {
    if (closing) return;
    setClosing(true);
    const element = frame.current;
    if (prefersReducedMotion() || !element || !fit) {
      onClose();
      return;
    }
    const rect = resolveOrigin(index)?.getBoundingClientRect();
    const visible =
      rect && rect.width > 0 && rect.bottom > 0 && rect.top < viewport.height && view.scale <= 1;
    backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      easing: 'ease-in',
      fill: 'forwards',
    });
    const keyframes =
      visible && rect
        ? [{ transform: 'none' }, { transform: resolveOriginTransform(rect, fit, viewport) }]
        : [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'scale(0.96)' },
          ];
    element
      .animate(keyframes, { duration: visible ? 260 : 180, easing: EASE, fill: 'forwards' })
      .finished.then(onClose, onClose);
  }

  function step(offset: number) {
    if (!many) return;
    onIndexChange(resolveStepIndex(index, offset, images.length));
  }

  React.useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!fitted) return;
      applyView(resolveWheelView(view, event, toStage(event.clientX, event.clientY), maxScale), false);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  function onKeyDown(event: React.KeyboardEvent) {
    const next = resolveKeyView(event.key, view, maxScale);
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (next) applyView(next, true);
    else return;
    event.preventDefault();
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    gesture.current = {
      start: { x: event.clientX, y: event.clientY },
      view,
      moved: points.length > 1,
      pinch: resolvePinch(points, viewport),
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    const pinched =
      current.pinch &&
      resolvePinchView(current.view, current.pinch, [...pointers.current.values()], maxScale);
    if (pinched) {
      applyView(pinched, false);
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (isPastTapSlop(current.start, point)) current.moved = true;
    if (current.moved && current.view.scale > 1)
      applyView(resolvePanView(current.view, current.start, point), false);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (pointers.current.size > 0) {
      const [rest] = [...pointers.current.values()];
      if (rest) gesture.current = { start: rest, view, moved: true, pinch: null };
      return;
    }
    gesture.current = null;
    if (!current || current.moved || event.type === 'pointercancel') return;
    const now = performance.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    applyView(resolveTapView(view, target, toStage(event.clientX, event.clientY)), true);
  }

  if (!image) return null;
  const caption = image.caption || resolveImageName(image.src);
  const zoomed = view.scale > 1;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          ref={backdrop}
          className='fixed inset-0 z-50 bg-black/85 backdrop-blur-sm'
        />
        <DialogPrimitive.Popup
          ref={stage}
          aria-label={caption}
          onKeyDown={onKeyDown}
          className='fixed inset-0 z-50 select-none overflow-hidden outline-none'
        >
          <button
            type='button'
            tabIndex={-1}
            aria-label='Close'
            onClick={requestClose}
            className='absolute inset-0 cursor-default outline-none'
          />
          <div className='pointer-events-none absolute inset-0 grid place-items-center'>
            <div ref={frame} className='will-change-transform'>
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{
                  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
                  transition: smooth ? `transform 260ms ${EASE}` : undefined,
                }}
                className={cn(
                  'pointer-events-auto touch-none',
                  zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
                )}
              >
                <img
                  key={image.src}
                  src={image.src}
                  alt={caption}
                  draggable={false}
                  ref={(element) => {
                    if (element?.complete && element.naturalWidth > 0) measure(element);
                  }}
                  onLoad={(event) => measure(event.currentTarget)}
                  style={fitted ? { width: fitted.width, height: fitted.height } : undefined}
                  className={cn(
                    'corner-superellipse/1.125 block max-w-none rounded-lg object-contain',
                    !fitted && 'invisible'
                  )}
                />
              </div>
            </div>
          </div>
          <div className='pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3'>
            <ChromeButton label='Close' shortcut='Esc' onClick={requestClose}>
              <Icon size='lg' name='IconCrossMedium' />
            </ChromeButton>
          </div>
          {many && (
            <>
              <ChromeButton
                label='Previous image'
                shortcut='←'
                onClick={() => step(-1)}
                className='absolute top-1/2 left-3 -translate-y-1/2'
              >
                <Icon size='lg' name='IconChevronLeftMedium' />
              </ChromeButton>
              <ChromeButton
                label='Next image'
                shortcut='→'
                onClick={() => step(1)}
                className='absolute top-1/2 right-3 -translate-y-1/2'
              >
                <Icon size='lg' name='IconChevronRightMedium' />
              </ChromeButton>
            </>
          )}
          <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4'>
            <div className='pointer-events-auto flex h-8 min-w-0 max-w-full items-center gap-2 rounded-full bg-white/10 px-3.5 text-white text-xs backdrop-blur-md sm:max-w-xl'>
              <DialogPrimitive.Title className='min-w-0 font-medium'>
                <Truncate>{caption}</Truncate>
              </DialogPrimitive.Title>
              {many && (
                <span className='shrink-0 text-white/60 tabular-nums'>
                  {index + 1} of {images.length}
                </span>
              )}
              {zoomed && fit && (
                <span className='shrink-0 text-white/60 tabular-nums'>
                  {describeZoom(view.scale, fit.actual)}
                </span>
              )}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ImageViewer({
  images,
  viewer,
}: {
  images: ViewerImage[];
  viewer: ReturnType<typeof useImageViewer>;
}) {
  if (viewer.index === null) return null;
  return (
    <ImageViewerDialog
      images={images}
      index={viewer.index}
      onIndexChange={viewer.show}
      onClose={viewer.close}
      resolveOrigin={viewer.resolveOrigin}
    />
  );
}
