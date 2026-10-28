import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@shinsa/ui/components/button';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { useImageViewer, ViewerImage } from '@/hooks/use-image-viewer.ts';
import {
  type Box,
  type Clip,
  clampView,
  describeZoom,
  FIT,
  isLeavingHeld,
  isPastTapSlop,
  type Landing,
  type Point,
  resolveFit,
  resolveImageName,
  resolveKeyView,
  resolveLanding,
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
  type Size,
  serializeLanding,
  type View,
  type ViewerSwap,
} from '@/lib/image-view.ts';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MOTION = { duration: 240, easing: EASE } as const;
const FADE_IN = [{ opacity: 0 }, { opacity: 1 }];
const FADE_OUT = [{ opacity: 1 }, { opacity: 0 }];
const SWAP_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const SHRUNK = 0.96;
const DOUBLE_TAP_MS = 300;

function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function resolveRadius(element: Element) {
  return Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
}

function resolveBox(element: Element): Box {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

function resolveThumbnail(origin: HTMLElement) {
  const clips: Clip[] = [];
  for (let parent = origin.parentElement; parent; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    if (overflowX !== 'visible' || overflowY !== 'visible') {
      clips.push({ box: resolveBox(parent), radius: resolveRadius(parent) });
    }
  }
  return {
    box: resolveBox(origin),
    objectFit: getComputedStyle(origin).objectFit,
    radius: resolveRadius(origin),
    clips,
  };
}

function resolveShrunk(view: View): View {
  return { ...view, scale: view.scale * SHRUNK };
}

function resolveOriginSize(origin: HTMLElement | null, src: string | undefined): Size | null {
  if (!src || origin?.getAttribute('src') !== src) return null;
  if (origin instanceof HTMLVideoElement && origin.videoWidth > 0) {
    return { width: origin.videoWidth, height: origin.videoHeight };
  }
  if (origin instanceof HTMLImageElement && origin.naturalWidth > 0) {
    return { width: origin.naturalWidth, height: origin.naturalHeight };
  }
  return null;
}

function settleAnimations(element: HTMLElement) {
  for (const animation of element.getAnimations()) {
    animation.commitStyles();
    animation.cancel();
  }
}

function clearMotionStyles(element: HTMLElement) {
  for (const property of ['opacity', 'translate', 'transform', 'clip-path']) {
    element.style.removeProperty(property);
  }
}

interface Layer {
  image: ViewerImage;
  view: View;
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
  icon,
  onClick,
  className,
}: {
  label: string;
  shortcut: string;
  icon: IconName;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <Button
        variant='outline'
        size='icon'
        aria-label={label}
        onClick={onClick}
        className={cn('pointer-events-auto', className)}
      >
        <Icon name={icon} />
      </Button>
    </Hint>
  );
}

function LayerVideo({
  src,
  name,
  size,
  live,
  onMeasure,
}: {
  src: string;
  name: string;
  size: Size | null;
  live: boolean;
  onMeasure: (element: HTMLVideoElement) => void;
}) {
  if (!size) {
    if (!live) return null;
    return (
      <video
        key={`measure-${src}`}
        src={src}
        muted
        preload='metadata'
        aria-hidden
        onLoadedMetadata={(event) => onMeasure(event.currentTarget)}
        className='invisible absolute'
      />
    );
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: agent recordings have no captions
    <video
      src={src}
      aria-label={name}
      aria-hidden={!live}
      controls
      autoPlay
      playsInline
      width={size.width}
      height={size.height}
      style={{ width: size.width, height: size.height }}
      className={cn(
        'corner-superellipse/1.125 block max-w-none rounded-lg bg-black object-contain',
        live && 'pointer-events-auto'
      )}
    />
  );
}

function LayerPicture({
  src,
  name,
  size,
  view,
  transition,
  landing,
  gestures,
  onMeasure,
}: {
  src: string;
  name: string;
  size: Size | null;
  view: View;
  transition: string | undefined;
  landing: boolean;
  gestures: React.HTMLAttributes<HTMLDivElement> | null;
  onMeasure: (element: HTMLImageElement) => void;
}) {
  return (
    <div
      {...gestures}
      style={{
        transform: landing ? undefined : `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
        transition,
      }}
      className={cn(
        gestures && 'pointer-events-auto touch-none',
        gestures && (view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')
      )}
    >
      <img
        src={src}
        alt={gestures ? name : ''}
        aria-hidden={!gestures}
        draggable={false}
        ref={(element) => {
          if (element?.complete && element.naturalWidth > 0) onMeasure(element);
        }}
        onLoad={(event) => onMeasure(event.currentTarget)}
        style={size ? { width: size.width, height: size.height } : undefined}
        className={cn(
          'corner-superellipse/1.125 block max-w-none rounded-lg object-contain',
          landing && 'rounded-none',
          !size && 'invisible'
        )}
      />
    </div>
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
  const video = image?.media === 'video';
  const viewport = useViewport();
  const [sizes, setSizes] = React.useState<Record<string, Size>>(() => {
    const size = resolveOriginSize(resolveOrigin(index), image?.src);
    return image && size ? { [image.src]: size } : {};
  });
  const [layers, setLayers] = React.useState<Layer[]>(() => (image ? [{ image, view: FIT }] : []));
  const [view, setView] = React.useState<View>(FIT);
  const [smooth, setSmooth] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const stage = React.useRef<HTMLDivElement | null>(null);
  const frame = React.useRef<HTMLDivElement | null>(null);
  const backdrop = React.useRef<HTMLDivElement>(null);
  const chrome = React.useRef<HTMLDivElement>(null);
  const shown = React.useRef<string | null>(null);
  const swap = React.useRef<ViewerSwap | null>(null);
  const elements = React.useRef(new Map<string, HTMLDivElement>());
  const leaving = React.useRef(new WeakSet<HTMLElement>());
  const liveSrc = React.useRef(image?.src);
  liveSrc.current = image?.src;
  const pointers = React.useRef(new Map<number, Point>());
  const gesture = React.useRef<{
    start: Point;
    view: View;
    moved: boolean;
    pinch: { distance: number; mid: Point } | null;
  } | null>(null);
  const lastTap = React.useRef(0);

  const gutter = many ? 72 : 24;
  const resolveShown = (src: string) => {
    const known = sizes[src];
    return known ? resolveShownSize(known, images.find((entry) => entry.src === src)?.width) : null;
  };
  const natural = image ? resolveShown(image.src) : null;
  const fit = resolveFit(natural, viewport, gutter);
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

  const mountStage = React.useCallback((element: HTMLDivElement | null) => {
    stage.current = element;
    setMounted(element !== null);
  }, []);

  React.useLayoutEffect(() => {
    const origin = resolveOrigin(index);
    if (!mounted || !origin) return;
    origin.style.visibility = 'hidden';
    return () => {
      origin.style.visibility = '';
    };
  }, [mounted, index, resolveOrigin]);

  React.useLayoutEffect(() => {
    if (!mounted) return;
    for (const element of [backdrop.current, chrome.current]) element?.animate(FADE_IN, MOTION);
  }, [mounted]);

  function resolveFlight(): Landing | null {
    const origin = resolveOrigin(index);
    if (!origin || !natural || !fitted || video || prefersReducedMotion()) return null;
    return resolveLanding(resolveThumbnail(origin), natural, fitted, viewport);
  }

  function resolveRest(at: View) {
    const media = frame.current?.querySelector('img');
    return resolveViewLanding(at, media ? resolveRadius(media) : 0);
  }

  React.useLayoutEffect(() => {
    const element = frame.current;
    if (!mounted || !fit || !element || !image || shown.current === image.src) return;
    const first = shown.current === null;
    shown.current = image.src;
    if (!first) {
      swapIn(element);
      return;
    }
    const flight = resolveFlight();
    const rest = serializeLanding(resolveRest(FIT));
    if (flight) element.animate([serializeLanding(flight), rest], MOTION);
    else if (video || prefersReducedMotion()) element.animate(FADE_IN, MOTION);
    else {
      const shrunk = serializeLanding(resolveRest(resolveShrunk(FIT)));
      element.animate(
        [
          { ...shrunk, opacity: 0 },
          { ...rest, opacity: 1 },
        ],
        MOTION
      );
    }
  });

  function resolveLayerFit(src: string) {
    const fitAt = resolveFit(resolveShown(src), viewport, gutter);
    return fitAt ? { width: fitAt.width, height: fitAt.height } : null;
  }

  function removeLayer(src: string) {
    elements.current.delete(src);
    setLayers((list) =>
      list.filter((layer) => layer.image.src !== src || layer.image.src === liveSrc.current)
    );
  }

  function swapIn(element: HTMLDivElement) {
    const motion = swap.current;
    if (!motion) return;
    const { duration, enter, leave } = resolveSwapMotion(motion, prefersReducedMotion());
    const timing = { duration, easing: SWAP_EASE, fill: 'forwards' } as const;
    const returning = element.getAnimations().length > 0;
    settleAnimations(element);
    leaving.current.delete(element);
    const entering = returning
      ? element.animate({ opacity: 1, translate: '0px 0px' }, timing)
      : element.animate(
          [
            { opacity: 0, translate: `${enter}px 0px` },
            { opacity: 1, translate: '0px 0px' },
          ],
          timing
        );
    entering.onfinish = () => {
      clearMotionStyles(element);
      entering.cancel();
    };
    for (const [src, other] of elements.current) {
      if (src === image?.src || leaving.current.has(other)) continue;
      leaving.current.add(other);
      settleAnimations(other);
      const held = isLeavingHeld(motion, resolveLayerFit(src), fitted);
      const exit = other.animate({ opacity: held ? 1 : 0, translate: `${leave}px 0px` }, timing);
      exit.onfinish = () => removeLayer(src);
    }
  }

  function record(element: HTMLElement, size: Size) {
    const src = element.getAttribute('src') ?? '';
    if (sizes[src]) return;
    setSizes((known) => ({ ...known, [src]: size }));
  }

  function measure(element: HTMLImageElement) {
    record(element, { width: element.naturalWidth, height: element.naturalHeight });
  }

  function measureVideo(element: HTMLVideoElement) {
    record(element, { width: element.videoWidth, height: element.videoHeight });
  }

  function requestClose() {
    if (closing) return;
    setClosing(true);
    const origin = resolveOrigin(index);
    const reveal = () => {
      if (origin) origin.style.visibility = '';
    };
    const finish = () => {
      reveal();
      onClose();
    };
    const fade = { ...MOTION, fill: 'forwards' } as const;
    for (const element of [backdrop.current, chrome.current]) element?.animate(FADE_OUT, fade);
    const element = frame.current;
    if (!element) {
      finish();
      return;
    }
    const running = element.getAnimations();
    const style = getComputedStyle(element);
    const rest = serializeLanding(resolveRest(view));
    const live = (value: string, fallback: string) =>
      running.length > 0 && value !== 'none' ? value : fallback;
    const from = {
      transform: live(style.transform, rest.transform),
      clipPath: live(style.clipPath, rest.clipPath),
      opacity: running.length > 0 ? Number(style.opacity) : 1,
      translate: style.translate === 'none' ? '0px 0px' : style.translate,
    };
    for (const [src, other] of elements.current) {
      if (src !== image?.src) other.animate({ opacity: 0 }, fade);
    }
    for (const animation of running) animation.cancel();
    const flight = resolveFlight();
    if (!flight) reveal();
    const to = {
      translate: '0px 0px',
      ...(flight
        ? { ...serializeLanding(flight), opacity: 1 }
        : video || prefersReducedMotion()
          ? { ...rest, opacity: 0 }
          : { ...serializeLanding(resolveRest(resolveShrunk(view))), opacity: 0 }),
    };
    element.animate([from, to], fade).finished.then(finish, finish);
  }

  function show(next: number, offset: number) {
    const to = images[next];
    if (closing || !image || !to || next === index) return;
    const size = resolveOriginSize(resolveOrigin(next), to.src);
    if (size && !sizes[to.src]) setSizes((known) => ({ ...known, [to.src]: size }));
    const ready = fitted !== null && shown.current === image.src;
    swap.current = resolveSwap(images, index, next, offset);
    setLayers((list) => {
      const kept = list
        .filter((layer) => layer.image.src !== image.src || ready)
        .map((layer) => (layer.image.src === image.src ? { image: layer.image, view } : layer));
      return kept.some((layer) => layer.image.src === to.src) ? kept : [...kept, { image: to, view: FIT }];
    });
    setSmooth(false);
    setView(FIT);
    onIndexChange(next);
  }

  function step(offset: number) {
    if (!many) return;
    show(resolveStepIndex(index, offset, images.length), offset);
  }

  React.useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!fitted || video) return;
      applyView(resolveWheelView(view, event, toStage(event.clientX, event.clientY), maxScale), false);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.defaultPrevented) return;
    const next = video ? null : resolveKeyView(event.key, view, maxScale);
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

  function renderLayer(layer: Layer) {
    const { src } = layer.image;
    const live = src === image?.src;
    const size = live ? fitted : resolveLayerFit(src);
    const name = layer.image.caption || resolveImageName(src);
    const isVideo = layer.image.media === 'video';
    return (
      <div
        key={src}
        ref={(element) => {
          if (element) elements.current.set(src, element);
          if (live) frame.current = element;
        }}
        style={{ zIndex: live ? 1 : 0 }}
        className={cn('col-start-1 row-start-1', live && !isVideo && 'will-change-transform')}
      >
        {isVideo ? (
          <LayerVideo src={src} name={name} size={size} live={live} onMeasure={measureVideo} />
        ) : (
          <LayerPicture
            src={src}
            name={name}
            size={size}
            view={live ? view : layer.view}
            transition={live && smooth && !closing ? `transform 260ms ${EASE}` : undefined}
            landing={live && closing}
            gestures={
              live ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } : null
            }
            onMeasure={measure}
          />
        )}
      </div>
    );
  }

  if (!image) return null;
  const caption = image.caption || resolveImageName(image.src);
  const zoomed = view.scale > 1;
  const item = resolveViewerItem(images, index);

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
          ref={mountStage}
          aria-label={caption}
          onKeyDown={onKeyDown}
          className='dark fixed inset-0 z-50 select-none overflow-hidden text-foreground outline-none'
        >
          <button
            type='button'
            tabIndex={-1}
            aria-label='Close'
            onClick={requestClose}
            className='absolute inset-0 cursor-default outline-none'
          />
          <div className='pointer-events-none absolute inset-0 grid place-items-center'>
            {(layers.some((layer) => layer.image.src === image.src)
              ? layers
              : [...layers, { image, view: FIT }]
            ).map((layer) => renderLayer(layer))}
          </div>
          <div ref={chrome} className='pointer-events-none absolute inset-0'>
            <div className='pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3'>
              <ChromeButton label='Close' shortcut='Esc' icon='IconCrossMedium' onClick={requestClose} />
            </div>
            {many && (
              <>
                <ChromeButton
                  label='Previous'
                  shortcut='←'
                  icon='IconChevronLeftMedium'
                  onClick={() => step(-1)}
                  className='absolute top-1/2 left-3 -translate-y-1/2'
                />
                <ChromeButton
                  label='Next'
                  shortcut='→'
                  icon='IconChevronRightMedium'
                  onClick={() => step(1)}
                  className='absolute top-1/2 right-3 -translate-y-1/2'
                />
              </>
            )}
            <div className='pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4'>
              <div
                className={cn(
                  'corner-superellipse/1.125 pointer-events-auto flex h-8 min-w-0 max-w-full items-center gap-2 rounded-popup bg-popover ps-3 text-popover-foreground text-xs shadow-3 sm:max-w-xl',
                  many && 'w-xl',
                  item.parts.length > 0 ? 'pe-0.75' : 'pe-3'
                )}
              >
                <DialogPrimitive.Title className={cn('min-w-0 font-medium', many && 'flex-1')}>
                  <Truncate>{caption}</Truncate>
                </DialogPrimitive.Title>
                {item.count > 1 && (
                  <span className='shrink-0 text-fg-2 tabular-nums'>
                    {item.position} of {item.count}
                  </span>
                )}
                {zoomed && fit && (
                  <span className='shrink-0 text-fg-2 tabular-nums'>
                    {describeZoom(view.scale, fit.actual)}
                  </span>
                )}
                {item.parts.length > 0 && (
                  <Choice
                    label='Which state'
                    value={String(index)}
                    onValueChange={(value) => show(Number(value), Number(value) - index)}
                    items={item.parts.map((part) => ({ value: String(part.index), label: part.name }))}
                    className='shrink-0'
                  />
                )}
              </div>
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
