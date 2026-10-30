'use client';

import { countVisibleChars } from '@shinsa/ui/lib/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { type ComponentProps, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function selectClipBox(element: HTMLElement): HTMLElement {
  let box: HTMLElement | null = element;
  while (box) {
    if (window.getComputedStyle(box).overflowX !== 'visible') return box;
    box = box.parentElement;
  }
  return element;
}

/**
 * How many leading characters of the line are on screen: a line cut off by
 * its own box or an ancestor's sweeps only those, so one cycle never spends
 * its time on characters behind the ellipsis.
 */
function useVisibleLength(length: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(length);

  useMeasureEffect(() => {
    const element = ref.current;
    if (!element) return;
    const clip = selectClipBox(element);
    const update = () => {
      const chars = [...element.querySelectorAll<HTMLElement>('[data-char]')];
      const rights = chars.map((char) => char.getBoundingClientRect().right);
      setVisible(countVisibleChars(rights, clip.getBoundingClientRect().right));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(clip);
    return () => observer.disconnect();
  }, [length]);

  return { ref, visible: Math.min(visible, length) };
}

export type ShimmeringTextProps = Omit<ComponentProps<typeof motion.span>, 'children'> & {
  /** The text to render with the shimmering effect. */
  text: string;
  /**
   * Duration in seconds for one shimmer cycle.
   * @defaultValue 1
   */
  duration?: number;
  /**
   * Pause the shimmer (e.g. when the hero leaves the viewport).
   * @defaultValue false
   */
  paused?: boolean;
};

export function ShimmeringText({
  text,
  duration = 1,
  paused = false,
  className,
  ...props
}: ShimmeringTextProps) {
  const reducedMotion = useReducedMotion();
  const stopped = paused || reducedMotion === true;
  const { ref, visible } = useVisibleLength(text.length);

  const createCharVariants = useCallback(
    (charIndex: number): Variants => ({
      running: {
        color: ['var(--color)', 'var(--shimmering-color)', 'var(--color)'],
        transition: {
          duration,
          repeat: Number.POSITIVE_INFINITY,
          repeatType: 'loop',
          repeatDelay: visible * 0.05,
          delay: (charIndex * duration) / visible,
          ease: 'easeInOut',
        },
      },
      stopped: {
        color: 'var(--color)',
        transition: {
          duration: duration * 0.5,
          ease: 'easeOut',
        },
      },
    }),
    [duration, visible]
  );

  return (
    <motion.span
      ref={ref}
      className={cn(
        'inline-flex select-none items-center leading-none',
        '[--color:var(--muted-foreground)] [--shimmering-color:var(--foreground)]',
        className
      )}
      {...props}
    >
      {text.split('').map((char, index) => (
        <motion.span
          animate={stopped || index >= visible ? 'stopped' : 'running'}
          aria-hidden
          data-char=''
          className='inline-block whitespace-pre leading-none'
          initial='stopped'
          key={`${visible}-${index}`}
          variants={createCharVariants(index)}
        >
          {char}
        </motion.span>
      ))}
      <span className='sr-only'>{text}</span>
    </motion.span>
  );
}
