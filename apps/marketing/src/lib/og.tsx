import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Logo } from '@shinsa/ui/components/logo';
import { renderToStaticMarkup } from 'react-dom/server';
import satori from 'satori';

const OG_SIZE = { width: 1200, height: 630 };

const INK = {
  strong: '#18181b',
  body: '#3f3f46',
  muted: '#71717a',
  faint: '#d4d4d8',
  line: '#e4e4e7',
  dot: '#dcdce0',
  page: '#ffffff',
  subtle: '#fafafa',
  accent: '#0a7aff',
};

const TONES = {
  green: { ink: '#15803d', tile: '#dcfce7' },
  amber: { ink: '#b45309', tile: '#fef3c7' },
  blue: { ink: '#0a6cdc', tile: '#dbeafe' },
  purple: { ink: '#7e22ce', tile: '#f3e8ff' },
};

type Tone = keyof typeof TONES;

interface QueueRow {
  icon: IconName;
  tone: Tone;
  running?: boolean;
  handle: string;
  title: string;
  status: string;
  reason: string;
  age: string;
}

interface QueueSection {
  label: string;
  rows: QueueRow[];
}

const SECTIONS: QueueSection[] = [
  {
    label: 'In progress',
    rows: [
      {
        icon: 'IconHammer',
        tone: 'blue',
        running: true,
        handle: 'NW-156',
        title: 'Stream order updates to the dashboard',
        status: 'Building',
        reason: 'Building phase 2 of 3',
        age: '40m',
      },
      {
        icon: 'IconHammer2',
        tone: 'blue',
        running: true,
        handle: 'NW-157',
        title: 'Fix the stale cart badge',
        status: 'Fixing',
        reason: 'Fixing a failing CI check',
        age: '5m',
      },
      {
        icon: 'IconMagnifyingGlass',
        tone: 'blue',
        running: true,
        handle: 'NW-158',
        title: 'Why do nightly exports stall?',
        status: 'Investigating',
        reason: 'Reproducing the stall',
        age: '18m',
      },
    ],
  },
];

function readFont(name: string) {
  return readFileSync(resolve(process.cwd(), `src/assets/fonts/${name}`));
}

function serializeSvg(markup: string, color: string) {
  const svg = markup
    .replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    .replaceAll('currentColor', color);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function createIconUri(name: IconName, color: string) {
  return serializeSvg(renderToStaticMarkup(<Icon name={name} />), color);
}

function createLogoUri() {
  return serializeSvg(renderToStaticMarkup(<Logo />), INK.strong);
}

function Dots() {
  const columns = Array.from({ length: OG_SIZE.width / 24 + 1 }, (_, index) => index * 24);
  const rows = Array.from({ length: OG_SIZE.height / 24 + 1 }, (_, index) => index * 24);
  return (
    <svg
      width={OG_SIZE.width}
      height={OG_SIZE.height}
      viewBox={`0 0 ${OG_SIZE.width} ${OG_SIZE.height}`}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      {rows.flatMap((y) =>
        columns.map((x) => <circle key={`${x}:${y}`} cx={x + 12} cy={y + 12} r={1.2} fill={INK.dot} />)
      )}
    </svg>
  );
}

function Traces() {
  const left = ['M 0 236 H 70 L 82 248 V 446 L 94 458 H 150', 'M 0 252 H 54 L 66 264 V 462 L 78 474 H 150'];
  const right = [
    'M 1200 236 H 1130 L 1118 248 V 446 L 1106 458 H 1050',
    'M 1200 252 H 1146 L 1134 264 V 462 L 1122 474 H 1050',
  ];
  return (
    <svg width={1200} height={630} viewBox='0 0 1200 630' style={{ position: 'absolute', top: 0, left: 0 }}>
      {[...left, ...right].map((d) => (
        <path key={d} d={d} fill='none' stroke={INK.faint} strokeWidth={1.25} />
      ))}
      <path
        d={left[0]}
        fill='none'
        stroke={INK.accent}
        strokeWidth={1.5}
        strokeDasharray='190 1000'
        strokeDashoffset={-180}
      />
      <path
        d={right[0]}
        fill='none'
        stroke={INK.accent}
        strokeWidth={1.5}
        strokeDasharray='190 1000'
        strokeDashoffset={-180}
      />
      {[458, 474].flatMap((y) => [
        <rect key={`l${y}`} x={146} y={y - 2} width={6} height={4} rx={1} fill={INK.accent} />,
        <rect key={`r${y}`} x={1048} y={y - 2} width={6} height={4} rx={1} fill={INK.accent} />,
      ])}
      {[
        [40, 560],
        [1160, 120],
        [1140, 560],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={3} fill='none' stroke={INK.faint} strokeWidth={1.25} />
      ))}
    </svg>
  );
}

interface GuideLine {
  lead: string;
  icon: IconName;
  tone: Tone;
  title: string;
  why: string;
}

const GUIDE: GuideLine[] = [
  {
    lead: 'Start with',
    icon: 'IconMerged',
    tone: 'green',
    title: 'Add Apple Pay to checkout',
    why: 'CI passed and both review bots are quiet.',
  },
  {
    lead: 'Then',
    icon: 'IconBubbleQuestion',
    tone: 'blue',
    title: 'Remove the v1 orders endpoint',
    why: 'one answer unblocks the agent.',
  },
];

function Guide() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 4px' }}>
      <span style={{ fontSize: 22, fontWeight: 500, color: INK.strong }}>Good afternoon.</span>
      {GUIDE.map((line) => (
        <div
          key={line.title}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 18, color: INK.body }}
        >
          <span>{line.lead}</span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              background: TONES[line.tone].tile,
            }}
          >
            <img src={createIconUri(line.icon, TONES[line.tone].ink)} width={14} height={14} alt='' />
          </div>
          <span style={{ fontWeight: 500, color: INK.strong }}>{line.title}:</span>
          <span>{line.why}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({ row }: { row: QueueRow }) {
  const tone = TONES[row.tone];
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 8,
        background: tone.tile,
      }}
    >
      <img src={createIconUri(row.icon, tone.ink)} width={17} height={17} alt='' />
      {row.running && (
        <div
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            width: 9,
            height: 9,
            borderRadius: 9,
            background: INK.accent,
            border: `2px solid ${INK.page}`,
          }}
        />
      )}
    </div>
  );
}

function Row({ row, first }: { row: QueueRow; first: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        height: 64,
        padding: '0 18px',
        borderTop: first ? 'none' : `1px solid ${INK.line}`,
      }}
    >
      <Tile row={row} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        <span style={{ fontSize: 19, color: INK.strong }}>{row.title}</span>
        <div style={{ display: 'flex', gap: 7, fontSize: 15, color: INK.muted }}>
          <span>{row.handle}</span>
          <span>·</span>
          <span style={{ color: TONES[row.tone].ink }}>{row.status}</span>
          <span>·</span>
          <span>{row.reason}</span>
        </div>
      </div>
      <span style={{ fontSize: 15, color: INK.muted }}>{row.age}</span>
    </div>
  );
}

function Section({ section }: { section: QueueSection }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, padding: '0 4px', fontSize: 16 }}>
        <span style={{ color: INK.body }}>{section.label}</span>
        <span style={{ color: INK.muted }}>{section.rows.length}</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: INK.page,
          border: `1px solid ${INK.line}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {section.rows.map((row, index) => (
          <Row key={row.handle} row={row} first={index === 0} />
        ))}
      </div>
    </div>
  );
}

function Card() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 150,
        top: 318,
        width: 900,
        height: 360,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: '26px 40px',
        background: INK.subtle,
        border: `1px solid ${INK.line}`,
        borderRadius: 20,
        boxShadow: '0 12px 40px rgba(24, 24, 27, 0.08)',
        overflow: 'hidden',
      }}
    >
      <Guide />
      {SECTIONS.map((section) => (
        <Section key={section.label} section={section} />
      ))}
    </div>
  );
}

function Image() {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        background: INK.page,
        fontFamily: 'Areal',
      }}
    >
      <Dots />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: OG_SIZE.width,
          height: OG_SIZE.height,
          backgroundImage:
            'radial-gradient(ellipse 52% 60% at 50% 44%, #ffffff 55%, rgba(255, 255, 255, 0) 100%)',
        }}
      />
      <Traces />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 52 }}>
        <img src={createLogoUri()} width={26} height={26} alt='' />
        <span style={{ fontSize: 26, fontWeight: 500, color: INK.strong }}>Shinsa</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginTop: 30,
          fontSize: 58,
          fontWeight: 500,
          letterSpacing: -2,
          lineHeight: 1.08,
        }}
      >
        <span style={{ color: INK.strong }}>Hand over the work.</span>
        <span style={{ color: INK.muted }}>Keep the decisions.</span>
      </div>
      <Card />
    </div>
  );
}

export async function renderOgImage() {
  const svg = await satori(<Image />, {
    ...OG_SIZE,
    fonts: [
      { name: 'Areal', data: readFont('ABCAreal-Regular.ttf'), weight: 400, style: 'normal' },
      { name: 'Areal', data: readFont('ABCAreal-Medium.ttf'), weight: 500, style: 'normal' },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_SIZE.width } }).render().asPng();
}
