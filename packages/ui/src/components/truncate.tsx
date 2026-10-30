'use client';

import { useTooltipTrigger } from '@shinsa/ui/components/tooltip';
import { isClipped, resolveMiddleTruncation } from '@shinsa/ui/lib/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

const useMeasureEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

const LINE_CLAMP = { 2: 'line-clamp-2 whitespace-normal', 3: 'line-clamp-3 whitespace-normal' };

let ruler: CanvasRenderingContext2D | null = null;

function widthOf(text: string, font: string): number {
  if (!ruler) ruler = document.createElement('canvas').getContext('2d');
  if (!ruler) return 0;
  ruler.font = font;
  return ruler.measureText(text).width;
}

function fontOf(element: HTMLElement): string {
  const style = window.getComputedStyle(element);
  if (style.font) return style.font;
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/**
 * A single line of text that truncates with an ellipsis and, only when it
 * actually is cut off, shows the full text in a tooltip on hover. Drop-in for
 * `<span className='truncate'>`; the wrapper must give it a bounded width
 * (`min-w-0` on flex children) exactly as with the bare utility.
 *
 * `middle` cuts in the centre instead of the end, so both ends of an identifier
 * stay readable. The cut is measured while the full string is rendered: at that
 * moment `scrollWidth` is the text's natural width and `clientWidth` the room it
 * was given. A cut belongs to the text it was measured for, so new text renders
 * in full and is measured again; a change in the parent's width does the same.
 * `lines` clamps to two or three lines instead of one. `tooltip` replaces the
 * tooltip's content when the children are not plain text (a shimmering line).
 */
function Truncate({
  children,
  className,
  middle = false,
  lines,
  tooltip,
  ...props
}: React.ComponentProps<'span'> & { middle?: boolean; lines?: 2 | 3; tooltip?: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = React.useState(false);
  const [cut, setCut] = React.useState<{ source: string; text: string } | null>(null);
  const [revision, setRevision] = React.useState(0);

  const full = middle && typeof children === 'string' ? children : null;
  const current = cut !== null && cut.source === full ? cut.text : null;

  useMeasureEffect(() => {
    const element = ref.current;
    if (!element || full === null || current !== null) return;

    const available = element.clientWidth;
    if (available <= 0) return;

    const natural = element.scrollWidth;
    if (natural <= available) {
      setClipped(false);
      return;
    }

    const font = fontOf(element);
    const canvas = widthOf(full, font);
    const scale = canvas > 0 ? natural / canvas : 1;
    setCut({
      source: full,
      text: resolveMiddleTruncation(full, available, (candidate) => widthOf(candidate, font) * scale),
    });
    setClipped(true);
  }, [full, current, revision]);

  useMeasureEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (full === null) {
      const update = () => setClipped(isClipped(element, lines ? 'block' : 'inline'));
      update();
      const resizes = new ResizeObserver(update);
      resizes.observe(element);
      const edits = new MutationObserver(update);
      edits.observe(element, { characterData: true, childList: true, subtree: true });
      return () => {
        resizes.disconnect();
        edits.disconnect();
      };
    }

    const parent = element.parentElement;
    if (!parent) return;
    let width = parent.clientWidth;
    const observer = new ResizeObserver(() => {
      if (parent.clientWidth === width) return;
      width = parent.clientWidth;
      setCut(null);
      setRevision((value) => value + 1);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [full, lines]);

  const text = (
    <span
      ref={ref}
      data-slot='truncate'
      className={cn(
        'block min-w-0',
        full !== null ? 'overflow-hidden whitespace-nowrap' : lines ? LINE_CLAMP[lines] : 'truncate',
        className
      )}
      {...props}
    >
      {full === null ? children : (current ?? full)}
    </span>
  );

  // The tooltip is offered only while the text is cut off; the trigger is the
  // span itself, so a row of text that fits pays for nothing.
  return useTooltipTrigger(
    text,
    clipped
      ? {
          className: 'max-w-72 whitespace-normal text-pretty [overflow-wrap:anywhere]',
          content: <span>{tooltip ?? full ?? children}</span>,
        }
      : null
  );
}

export { Truncate };
