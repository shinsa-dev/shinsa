import { CopyButton } from '@/components/controls/copy-button.tsx';
import { resolveFenceLanguage, type Token, useLanguageTokens } from '@/lib/code/highlight.ts';

export function TokenText({ text, tokens }: { text: string; tokens: Token[] | undefined }) {
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens have no identity beyond their position
          key={index}
          style={token.style}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

export function CodeFence({ code, language }: { code: string; language: string | null }) {
  const tokens = useLanguageTokens(code, resolveFenceLanguage(language));
  return (
    <div className='group/code corner-superellipse/1.125 relative my-3 min-w-0 rounded-lg bg-bg-2 first:mt-0 last:mb-0'>
      <pre className='overflow-x-auto px-3.5 py-2.5 font-mono text-2xs text-fg-4 leading-relaxed'>
        <code className='block'>
          {code.split('\n').map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <span key={index} className='block min-h-[1lh] whitespace-pre'>
              <TokenText text={line} tokens={tokens?.[index]} />
            </span>
          ))}
        </code>
      </pre>
      <CopyButton
        text={code}
        className='absolute top-1.5 right-1.5 opacity-0 transition-opacity duration-150 group-hover/code:opacity-100'
      />
    </div>
  );
}
