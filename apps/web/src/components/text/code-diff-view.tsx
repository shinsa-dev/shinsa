import {
  type FileDiffMetadata,
  getFiletypeFromFileName,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
  registerCustomTheme,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import * as React from 'react';
import { ShowMoreButton } from '@/components/chat/code-lines.tsx';
import type { CodeDiffProps } from '@/components/text/code-diff.tsx';
import { DIFF_CSS, DIFF_STYLE } from '@/lib/code/diff-theme.ts';
import {
  countDiffRows,
  type DiffSource,
  resolveDiffClamp,
  serializePatch,
  terminateText,
} from '@/lib/code/diff-view.ts';
import { CODE_THEME } from '@/lib/code/highlight.ts';
import { formatCount } from '@/lib/format/count.ts';
import { useColorScheme } from '@/lib/preferences/theme.ts';

const THEME = 'shinsa-diff';

registerCustomTheme(THEME, () => Promise.resolve({ ...CODE_THEME, name: THEME }));

const prepared = new Set<string>();

const preparing = new Map<string, Promise<boolean>>();

function prepareHighlighter(language: string) {
  const known = preparing.get(language);
  if (known) return known;
  const pending = preloadHighlighter({ themes: [THEME], langs: [language] }).then(
    () => true,
    () => false
  );
  preparing.set(language, pending);
  void pending.then(() => prepared.add(language));
  return pending;
}

export function prepareLanguages(paths: readonly string[]) {
  return Promise.all([...new Set(paths.map(getFiletypeFromFileName))].map(prepareHighlighter));
}

function useHighlighter(path: string) {
  const language = getFiletypeFromFileName(path);
  const [ready, setReady] = React.useState<string | null>(prepared.has(language) ? language : null);
  React.useEffect(() => {
    let alive = true;
    void prepareHighlighter(language).then(() => {
      if (alive) setReady(language);
    });
    return () => {
      alive = false;
    };
  }, [language]);
  return ready === language || prepared.has(language);
}

function resolveFileDiff(source: DiffSource): FileDiffMetadata | null {
  if (source.kind === 'patch') return parsePatchFiles(serializePatch(source))[0]?.files[0] ?? null;
  const before = terminateText(source.before);
  const after = terminateText(source.after);
  return parseDiffFromFile(
    before === null ? null : { name: source.path, contents: before },
    after === null ? null : { name: source.path, contents: after }
  );
}

export default function CodeDiffView({ source, numbered = false, selected = null }: CodeDiffProps) {
  const ready = useHighlighter(source.path);
  const scheme = useColorScheme();
  const [expanded, setExpanded] = React.useState(false);
  const fileDiff = React.useMemo(() => resolveFileDiff(source), [source]);
  const options = React.useMemo(
    () => ({
      theme: THEME,
      themeType: scheme,
      diffStyle: 'unified' as const,
      diffIndicators: numbered ? ('bars' as const) : ('classic' as const),
      disableFileHeader: true,
      disableLineNumbers: !numbered,
      overflow: 'scroll' as const,
      hunkSeparators: 'simple' as const,
      lineDiffType: 'word-alt' as const,
      unsafeCSS: DIFF_CSS,
    }),
    [scheme, numbered]
  );
  if (!ready || !fileDiff) return null;
  const clamp = resolveDiffClamp(countDiffRows(fileDiff.hunks), expanded);
  return (
    <>
      <div
        className='selectable min-w-0 overflow-hidden'
        style={clamp.maxHeight === null ? undefined : { maxHeight: clamp.maxHeight }}
      >
        <FileDiff
          fileDiff={fileDiff}
          options={options}
          selectedLines={selected && { start: selected.start, end: selected.end, side: 'additions' }}
          style={DIFF_STYLE as React.CSSProperties}
        />
      </div>
      {clamp.hidden > 0 && (
        <ShowMoreButton
          label={`Show ${formatCount(clamp.hidden, 'more line', 'more lines')}`}
          onClick={() => setExpanded(true)}
        />
      )}
    </>
  );
}
