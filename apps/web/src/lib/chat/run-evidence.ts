import type { Evidence } from '@shinsa/core';
import * as React from 'react';
import type { ViewerImage } from '@/hooks/use-image-viewer.ts';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { readString } from '@/lib/chat/tool-describe.ts';

const IMAGE_URI = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

export const TaskEvidence = React.createContext<ReadonlyMap<string, Evidence[]>>(new Map());

export const RunEvidence = React.createContext<Evidence[]>([]);

export function resolveCallImages(call: ToolCall, evidence: Evidence[]): (string | ViewerImage)[] {
  if (call.tool.kind !== 'shinsa' || call.tool.name !== 'attach_evidence') return call.images;
  const title = readString(call.tool.args, 'title');
  const match = evidence.find((item) => item.title === title && IMAGE_URI.test(item.uri));
  return match
    ? [{ src: match.uri, caption: match.title, width: match.width ?? null }, ...call.images]
    : call.images;
}
