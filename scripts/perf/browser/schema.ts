import { Schema } from 'effect';
import type { Key } from '../../kit/chromium/index.ts';

export const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

export const PointOrNull = Schema.NullOr(Point);

export const HeapUsage = Schema.Struct({ usedSize: Schema.Finite });

export const ESCAPE: Key = { key: 'Escape', code: 'Escape', keyCode: 27 };

export const ENTER: Key = { key: 'Enter', code: 'Enter', keyCode: 13 };

export const META = 4;

export const SHIFT = 8;
