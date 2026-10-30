import { type CostLine, describeUsd } from '@shinsa/core';

const LARGE_UNITS = [
  { size: 1e6, suffix: 'M' },
  { size: 1e9, suffix: 'B' },
  { size: 1e12, suffix: 'T' },
];

function roundScaled(value: number) {
  return value < 100 ? Number(value.toFixed(1)) : Math.round(value);
}

function formatCompact(value: number, thousand: 'k' | 'K') {
  for (const unit of [{ size: 1e3, suffix: thousand }, ...LARGE_UNITS]) {
    const scaled = roundScaled(value / unit.size);
    if (scaled < 1_000) return `${scaled}${unit.suffix}`;
  }
  return `${Math.round(value / 1e12)}T`;
}

export function formatTokenCount(count: number) {
  if (count < 1_000) return String(count);
  return formatCompact(count, 'k');
}

export function formatTokens(count: number) {
  return `${formatTokenCount(count)} tokens`;
}

export function formatCompactUsd(value: number) {
  if (Number(value.toFixed(2)) < 1_000) return describeUsd(value);
  return `$${formatCompact(value, 'K')}`;
}

export function formatCost(line: CostLine) {
  if (line.unpricedRuns === line.runs) return 'Unknown';
  return line.unpricedRuns > 0 ? `${describeUsd(line.knownUsd)} + unknown` : describeUsd(line.knownUsd);
}
