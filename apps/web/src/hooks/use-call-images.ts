import * as React from 'react';
import { RunEvidence, resolveCallImages } from '@/lib/chat/run-evidence.ts';
import type { ToolCall } from '@/lib/chat/timeline.ts';

export function useCallImages(call: ToolCall) {
  const evidence = React.useContext(RunEvidence);
  return React.useMemo(() => resolveCallImages(call, evidence), [call, evidence]);
}
