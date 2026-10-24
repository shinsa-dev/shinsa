import * as React from 'react';
import { type CodeMode, type CodePatch, parseCodeLocation } from '@/lib/code/location.ts';
import { updateSearchParams, useSearchString } from '@/router.ts';

function applyCodePatch(patch: CodePatch, options: { replace?: boolean } = {}) {
  updateSearchParams(patch, options);
}

export function useCodeLocation(modes: CodeMode[]) {
  const search = useSearchString();
  const key = modes.join(',');
  const location = React.useMemo(() => {
    const params = new URLSearchParams(search);
    return parseCodeLocation((name) => params.get(name), key.split(',') as CodeMode[]);
  }, [search, key]);
  return { location, apply: applyCodePatch };
}
