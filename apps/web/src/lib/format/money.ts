import { type CostLine, describeUsd } from '@shinsa/core';

export function formatTokenCount(count: number) {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatTokens(count: number) {
  return `${formatTokenCount(count)} tokens`;
}

export function formatCost(line: CostLine) {
  if (line.unpricedRuns === line.runs) return 'Unknown';
  return line.unpricedRuns > 0 ? `${describeUsd(line.knownUsd)} + unknown` : describeUsd(line.knownUsd);
}
