import { DomainError } from '@shinsa/core';
import { Result } from 'effect';
import {
  listAgentSpecs,
  readToolInput,
  resolveInputSchema,
  resolveToolName,
  type SurfaceSpec,
  type Values,
} from '../../surface/index.ts';
import type { ToolSpec } from '../tools/schema.ts';

function resolveSurfaceToolSpec(spec: SurfaceSpec): ToolSpec {
  const reads = spec.access === 'read';
  return {
    name: resolveToolName(spec),
    description: `${spec.summary}${reads ? ' It only reads.' : ''} Same as \`shinsa ${spec.path.join(' ')}\`.`,
    inputSchema: resolveInputSchema(spec.fields),
    annotations: { readOnlyHint: reads, destructiveHint: !reads, idempotentHint: reads },
  };
}

export function listSurfaceToolSpecs() {
  return listAgentSpecs().map(resolveSurfaceToolSpec);
}

const SURFACE_TOOL_NAMES = new Set(listAgentSpecs().map(resolveToolName));

export function isSurfaceTool(name: string) {
  return SURFACE_TOOL_NAMES.has(name);
}

interface SurfaceToolCall {
  spec: SurfaceSpec;
  values: Values;
}

export function readSurfaceToolCall(
  name: string,
  input: Record<string, unknown>
): Result.Result<SurfaceToolCall, DomainError> {
  const spec = listAgentSpecs().find((candidate) => resolveToolName(candidate) === name);
  if (!spec) return Result.fail(new DomainError({ code: 'tool_unknown', message: `No tool ${name}.` }));
  return Result.map(readToolInput(spec.fields, input), (values) => ({ spec, values }));
}
