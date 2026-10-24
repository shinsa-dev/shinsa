import type { ShinsaState } from '@shinsa/core';
import { ReferenceText } from '@/components/links/reference.tsx';
import { dropPullRequestNumbers } from '@/lib/home.ts';

export function GuideText({
  text,
  state,
  exclude = [],
}: {
  text: string;
  state: ShinsaState;
  exclude?: string[];
}) {
  return (
    <ReferenceText
      text={dropPullRequestNumbers(text)}
      state={state}
      options={{ numbers: false, exclude: new Set(exclude) }}
    />
  );
}
