export interface ChipRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Bus {
  d: string;
  from: number;
  to: number;
}

interface Pin {
  x: number;
  y: number;
  chip: number;
}

interface Via {
  x: number;
  y: number;
}

export interface Board {
  traces: string[];
  buses: Bus[];
  pins: Pin[];
  vias: Via[];
  pads: { x: number; y: number; width: number; height: number }[];
}

const LANES = 2;
const LANE_GAP = 16;
const LANE_INSET = 28;
const PIN_GAP = 16;
const EXIT_INSET = 72;
const ENTRY_INSET = 152;
const CHAMFER = 10;
const MIN_EDGE = 12;
const STUB_ROOM = 96;
const GRID = 8;

type Side = 'left' | 'right';

function snap(value: number) {
  return Math.round(value / GRID) * GRID;
}

function createRandom(seed: number) {
  let state = seed % 2147483647 || 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function resolveLaneX(side: Side, edge: number, lane: number) {
  const offset = LANE_INSET + lane * LANE_GAP;
  return side === 'left' ? edge - offset : edge + offset;
}

function countLanes(side: Side, edge: number, width: number) {
  for (let lanes = LANES; lanes > 0; lanes -= 1) {
    const outer = resolveLaneX(side, edge, lanes - 1);
    if (side === 'left' ? outer >= MIN_EDGE : outer <= width - MIN_EDGE) return lanes;
  }
  return 0;
}

function routeLane(side: Side, from: ChipRect, to: ChipRect, lane: number, lanes: number) {
  const direction = side === 'left' ? -1 : 1;
  const fromEdge = side === 'left' ? from.left : from.right;
  const toEdge = side === 'left' ? to.left : to.right;
  const edge = side === 'left' ? Math.min(fromEdge, toEdge) : Math.max(fromEdge, toEdge);
  const x = resolveLaneX(side, edge, lane);
  const exit = from.bottom - EXIT_INSET - lane * PIN_GAP;
  const entry = to.top + ENTRY_INSET + (lanes - 1 - lane) * PIN_GAP;
  const turn = -direction * CHAMFER;
  return {
    d: [
      `M ${fromEdge} ${exit}`,
      `H ${x + turn}`,
      `L ${x} ${exit + CHAMFER}`,
      `V ${entry - CHAMFER}`,
      `L ${x + turn} ${entry}`,
      `H ${toEdge}`,
    ].join(' '),
    exit,
    entry,
    pins: [
      { x: fromEdge, y: exit },
      { x: toEdge, y: entry },
    ],
  };
}

function createStubs(side: Side, chip: ChipRect, room: number, seed: number, pageWidth: number) {
  const random = createRandom(seed);
  const traces: string[] = [];
  const vias: Via[] = [];
  const pads: Board['pads'] = [];
  const direction = side === 'left' ? -1 : 1;
  const start = side === 'left' ? MIN_EDGE : pageWidth - MIN_EDGE;
  const count = 1 + Math.floor(random() * 2);
  for (let index = 0; index < count; index += 1) {
    const y = snap(chip.top + 24 + random() * Math.max(0, chip.bottom - chip.top - 48));
    const reach = snap(Math.min(room - 24, 32 + random() * (room - 40)));
    const rise = (random() > 0.5 ? 1 : -1) * GRID * 2;
    const firstLeg = snap(reach * (0.3 + random() * 0.4));
    const x0 = start;
    const x1 = x0 - direction * firstLeg;
    const x2 = x1 - direction * Math.abs(rise);
    const x3 = x0 - direction * reach;
    if (Math.abs(x3 - x0) <= Math.abs(x2 - x0)) continue;
    traces.push(`M ${x0} ${y} H ${x1} L ${x2} ${y + rise} H ${x3}`);
    vias.push({ x: x3, y: y + rise });
    if (random() > 0.75) {
      const padX = side === 'left' ? x1 - 4 : x1 - 10;
      pads.push({ x: padX, y: y - 3, width: 14, height: 6 });
    }
  }
  return { traces, vias, pads };
}

function addSide(board: Board, chips: ChipRect[], index: number, side: Side, pageWidth: number) {
  const from = chips[index]!;
  const to = chips[index + 1];
  const edge = side === 'left' ? from.left : from.right;
  const lanes = countLanes(side, edge, pageWidth);
  const outerLane = lanes > 0 ? resolveLaneX(side, edge, lanes - 1) : edge;
  const room = side === 'left' ? outerLane - MIN_EDGE : pageWidth - MIN_EDGE - outerLane;
  if (room >= STUB_ROOM) {
    const stubs = createStubs(side, from, room - 12, index * 7 + (side === 'left' ? 1 : 3), pageWidth);
    board.traces.push(...stubs.traces);
    board.vias.push(...stubs.vias);
    board.pads.push(...stubs.pads);
  }
  if (!to) return;
  for (let lane = 0; lane < lanes; lane += 1) {
    const route = routeLane(side, from, to, lane, lanes);
    board.traces.push(route.d);
    board.pins.push({ ...route.pins[0]!, chip: index }, { ...route.pins[1]!, chip: index + 1 });
    if (lane === 0) board.buses.push({ d: route.d, from: route.exit, to: route.entry });
  }
}

export function resolveBoard(chips: ChipRect[], pageWidth: number): Board {
  const board: Board = { traces: [], buses: [], pins: [], vias: [], pads: [] };
  for (const index of chips.keys()) {
    addSide(board, chips, index, 'left', pageWidth);
    addSide(board, chips, index, 'right', pageWidth);
  }
  return board;
}

export function resolveSignal(bus: Bus, center: number) {
  if (bus.to <= bus.from) return 0;
  return Math.min(1, Math.max(0, (center - bus.from) / (bus.to - bus.from)));
}
