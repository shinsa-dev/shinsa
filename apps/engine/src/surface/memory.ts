import type { MemoryEntry } from '@shinsa/core';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec } from './fields.ts';
import { findProjectId } from './resolve.ts';
import { defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';

type MemoryView = MemoryEntry & { project: string | null };

const MEMORY_FIELD: FieldSpec = {
  name: 'memory',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The memory id, from `shinsa memory list`.',
};

function describeMemory(entry: MemoryView) {
  const scope = entry.project ?? 'every project';
  const status = entry.status === 'proposed' ? 'proposed' : 'kept';
  return `${entry.id}  (${status}, ${scope}) ${entry.text}`;
}

async function resolveScope(client: SurfaceClient, memoryId: string | null, project: string) {
  if (project) return await findProjectId(client, project);
  if (!memoryId) return null;
  const { memory } = await client.read<{ memory: MemoryView[] }>('/api/memory');
  return memory.find((entry) => entry.id === memoryId)?.projectId ?? null;
}

export const MEMORY_SPECS: SurfaceSpec[] = [
  defineRead<{ memory: MemoryView[] }>({
    path: ['memory', 'list'],
    summary: 'List the rules agents remember, and the ones agents proposed that wait for you.',
    fields: [],
    request: () => '/api/memory',
    format: ({ memory }) =>
      memory.length === 0 ? 'Agents remember nothing yet.' : memory.map(describeMemory).join('\n'),
  }),
  defineCommand({
    path: ['memory', 'write'],
    summary: 'Write a rule every agent follows, or change one with --id.',
    command: 'memory.write',
    humanOnly: true,
    fields: [
      { name: 'id', kind: 'text', description: 'The rule to change. Leave out to write a new one.' },
      {
        name: 'project',
        kind: 'text',
        description:
          'Only for this project (key, name or id). Leave out for every project, or with --id to keep the rule where it is.',
      },
      { name: 'text', kind: 'text', positional: 'rest', required: true, description: 'The rule.' },
    ],
    build: async (values, client) => {
      const memoryId = readValue(values, 'id') || null;
      return {
        type: 'memory.write',
        memoryId,
        projectId: await resolveScope(client, memoryId, readValue(values, 'project')),
        text: readValue(values, 'text'),
      };
    },
    done: () => 'Agents remember it.',
  }),
  defineCommand({
    path: ['memory', 'keep'],
    summary: 'Keep a rule an agent proposed, so every later agent follows it.',
    command: 'memory.accept',
    humanOnly: true,
    fields: [MEMORY_FIELD],
    build: (values) => ({ type: 'memory.accept', memoryId: readValue(values, 'memory') }),
    done: () => 'Kept.',
  }),
  defineCommand({
    path: ['memory', 'remove'],
    summary: 'Forget a rule, or dismiss one an agent proposed.',
    command: 'memory.remove',
    humanOnly: true,
    fields: [MEMORY_FIELD],
    build: (values) => ({ type: 'memory.remove', memoryId: readValue(values, 'memory') }),
    done: () => 'Removed.',
  }),
];
