import { CodeBlock } from '@/components/text/code-block.tsx';
import { resolveBlockCommand, resolveBlockCopy, resolveCodeCorner } from '@/lib/code/block.ts';
import { isTextDiagram, resolveFenceLanguage, type Token, useLanguageTokens } from '@/lib/code/highlight.ts';

export function TokenText({ text, tokens }: { text: string; tokens: Token[] | undefined }) {
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span
          // oxlint-disable-next-line shinsa/no-array-index-key -- tokens have no identity beyond their position
          key={index}
          style={token.style}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

export function CodeFence({
  code,
  language,
  runnable = false,
  capped = false,
}: {
  code: string;
  language: string | null;
  runnable?: boolean;
  capped?: boolean;
}) {
  const tokens = useLanguageTokens(code, resolveFenceLanguage(language));
  return (
    <CodeBlock
      copy={resolveBlockCopy(code, language)}
      command={resolveBlockCommand(code, language, runnable)}
      corner={resolveCodeCorner(code)}
      className='my-3 first:mt-0 last:mb-0'
    >
      <pre
        data-diagram={isTextDiagram(code) || undefined}
        data-capped={capped || undefined}
        className='overflow-x-auto px-3.5 py-2.5 font-mono text-2xs leading-relaxed text-fg-4 data-capped:max-h-80 data-capped:overflow-y-auto data-diagram:leading-3.5'
      >
        <code className='block'>
          {code.split('\n').map((line, index) => (
            // oxlint-disable-next-line shinsa/no-array-index-key -- lines are positional
            <span key={index} className='block min-h-[1lh] whitespace-pre'>
              <TokenText text={line} tokens={tokens?.[index]} />
            </span>
          ))}
        </code>
      </pre>
    </CodeBlock>
  );
}
