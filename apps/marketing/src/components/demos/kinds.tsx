import type { TaskShape } from '@shinsa/core';
import { Tabs, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import * as React from 'react';
import { NowCard } from '@/components/overview/now-card.tsx';
import { SHAPE_LABEL } from '@/lib/tasks/shapes.ts';
import { createKindsState, KIND_ENDS, KIND_ORDER } from '../../lib/kinds-scene.ts';
import { useFocus } from './focus.ts';
import { DemoRoot, Stage } from './frame.tsx';

const DWELL_MS = 2800;

function centreSelectedTab(root: HTMLElement | null) {
  const tab = root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  const list = tab?.parentElement;
  if (!tab || !list || list.scrollWidth <= list.clientWidth) return;
  const offset = tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
  list.scrollTo({ left: offset - (list.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
}

function nextKind(kind: TaskShape) {
  return KIND_ORDER[(KIND_ORDER.indexOf(kind) + 1) % KIND_ORDER.length]!;
}

export function KindsDemo() {
  const [{ state, scenes }] = React.useState(() => createKindsState(Date.now()));
  const [kind, setKind] = React.useState<TaskShape>('answer');
  const [picked, setPicked] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const { ref, focused } = useFocus<HTMLDivElement>();
  const scene = scenes[kind];
  const tabs = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => centreSelectedTab(tabs.current), [kind]);

  React.useEffect(() => {
    if (picked || hovered || !focused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setTimeout(() => setKind(nextKind), DWELL_MS);
    return () => clearTimeout(timer);
  }, [kind, picked, hovered, focused]);

  return (
    <DemoRoot>
      <Stage className='flex h-full flex-col items-center gap-8 max-sm:gap-6'>
        <Tabs
          ref={tabs}
          className='min-w-0 max-w-full'
          value={kind}
          onValueChange={(value) => {
            setPicked(true);
            setKind(value as TaskShape);
          }}
        >
          <TabsList className='justify-center-safe max-w-full overflow-x-auto [scrollbar-width:none]'>
            {KIND_ORDER.map((shape) => (
              <TabsTrigger key={shape} value={shape}>
                {SHAPE_LABEL[shape]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div
          ref={ref}
          className='flex min-h-0 w-full max-w-xl flex-1 flex-col gap-4'
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <div className='flex shrink-0 flex-col gap-1 text-center'>
            <p className='text-base text-fg-4'>“{scene.task.title}”</p>
            <p className='text-fg-2 text-sm'>{KIND_ENDS[kind]}</p>
          </div>
          <div className='demo-static demo-pre min-h-0 flex-1 overflow-hidden text-left'>
            <NowCard
              state={state}
              task={scene.task}
              gate={scene.gate ?? undefined}
              onOpen={() => undefined}
            />
          </div>
        </div>
      </Stage>
    </DemoRoot>
  );
}
