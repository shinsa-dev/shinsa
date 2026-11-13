import { Icon } from '@shinsa/ui/components/icon';
import { koeTools } from '../../../lib/content.ts';
import type { KoePill } from '../../../lib/koe-scene.ts';
import { KoePillView } from './pill.tsx';

const TOOL_PILLS: Record<string, KoePill> = {
  Comment: {
    kind: 'prompt',
    stage: 'listening',
    icon: 'IconBubbleAnnotation2',
    title: 'Say comment 1',
    detail: 'Save',
  },
  Screenshot: {
    kind: 'prompt',
    stage: 'picking',
    icon: 'IconScreenCapture',
    title: 'Drag over a region, or click a window',
    detail: 'Northwind · Settings',
  },
  Clip: { kind: 'prompt', stage: 'recording', icon: 'IconVideo', title: 'Recording a clip', detail: '0:04' },
  File: { kind: 'session', clock: '0:21', attached: 4 },
};

function FileChip() {
  return (
    <span className='flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1.5 text-xs text-fg-4 shadow-md ring-1 ring-bg-3 [--icon-size:14px]'>
      <span className='text-red-text'>
        <Icon name='IconFilePdf' />
      </span>
      spec.pdf
    </span>
  );
}

export function KoeTools() {
  return (
    <div className='grid gap-4 md:grid-cols-2'>
      {koeTools.map((tool) => (
        <div key={tool.title} className='flex flex-col overflow-hidden rounded-2xl ring-1 ring-bg-3'>
          <div className='koe-desktop relative flex h-36 flex-col items-center justify-center gap-3 overflow-hidden'>
            {tool.title === 'File' && <FileChip />}
            <KoePillView pill={TOOL_PILLS[tool.title]!} className='origin-center shadow-xl max-sm:scale-75' />
          </div>
          <div className='flex flex-col gap-1 border-t border-bg-3 bg-background p-4'>
            <span className='flex items-center gap-2 text-sm font-medium text-fg-4 [--icon-size:var(--icon-size-md)]'>
              <span className='text-fg-2'>
                <Icon name={tool.icon} />
              </span>
              {tool.title}
              <span className='font-normal text-fg-2'>· {tool.trigger}</span>
            </span>
            <p className='text-sm leading-relaxed text-pretty text-fg-2'>{tool.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
