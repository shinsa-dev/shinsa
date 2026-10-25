import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledLanguages } from 'shiki/langs';
import { INITIAL } from 'shiki/textmate';
import { CODE_THEME, IGNORE_GRAMMAR, listEmbeddedGrammars } from '@/lib/code/grammar.ts';
import type { GrammarEngine, LineGrammar } from './textmate.ts';

const EMBEDDING = new Set(['markdown', 'mdx']);

function isKnownGrammar(id: string) {
  return id === IGNORE_GRAMMAR.name || id in bundledLanguages;
}

export function createShikiEngine(): GrammarEngine {
  let core: Promise<HighlighterCore> | null = null;
  let colors: readonly string[] = [];
  const loaded = new Map<string, Promise<void>>();

  function requestCore() {
    core ??= createHighlighterCore({
      themes: [CODE_THEME],
      langs: [],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    });
    return core;
  }

  function requestGrammar(highlighter: HighlighterCore, id: string) {
    const known = loaded.get(id);
    if (known) return known;
    const source =
      id === IGNORE_GRAMMAR.name ? IGNORE_GRAMMAR : bundledLanguages[id as keyof typeof bundledLanguages];
    const pending = highlighter.loadLanguage(source as Parameters<HighlighterCore['loadLanguage']>[0]);
    loaded.set(id, pending);
    return pending;
  }

  return {
    initial: INITIAL as unknown as GrammarEngine['initial'],
    colors: () => colors,
    async load(grammar, text) {
      if (!isKnownGrammar(grammar)) return null;
      const highlighter = await requestCore();
      const embedded = EMBEDDING.has(grammar) ? listEmbeddedGrammars(text).filter(isKnownGrammar) : [];
      await Promise.all([grammar, ...embedded].map((id) => requestGrammar(highlighter, id)));
      const { theme, colorMap } = highlighter.setTheme(CODE_THEME.name ?? '');
      colors = colorMap.map((color) => theme.colorReplacements?.[color.toLowerCase()] ?? color);
      return highlighter.getLanguage(grammar) as unknown as LineGrammar;
    },
  };
}
