const CODE_SPAN = /(`[^`\n]*`)/;
const LINK = /(\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+)/;
const CODE_LIKE =
  /(?<![\w`/.@-])((?:[\w$]+\.)*[\w$]+\(\)|(?:[\w@.-]+\/)+[\w.-]+\.[a-z]{1,5}|[\w-]+\.(?:tsx?|jsx?|json|css|md|ya?ml|swift|kt|py|go|rs|sh)|--[a-z][\w-]+|[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[a-z][a-z0-9]*_[a-z0-9_]+)(?![\w`/])/g;

const PROSE_WORDS = new Set([
  'GitHub',
  'GitLab',
  'TypeScript',
  'JavaScript',
  'PostgreSQL',
  'MySQL',
  'SQLite',
  'MongoDB',
  'DynamoDB',
  'GraphQL',
  'ClickHouse',
  'OpenAI',
  'YouTube',
  'LinkedIn',
  'PayPal',
  'WordPress',
  'SwiftUI',
  'TestFlight',
  'AppStore',
  'CodeRabbit',
  'iOS',
  'iPadOS',
  'macOS',
  'watchOS',
  'tvOS',
  'visionOS',
  'iPhone',
  'iPad',
  'eBay',
]);

function wrapPlain(text: string) {
  return text.replace(CODE_LIKE, (match: string) => (PROSE_WORDS.has(match) ? match : `\`${match}\``));
}

export function markInlineCode(text: string) {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((block) =>
      block.startsWith('```')
        ? block
        : block
            .split(CODE_SPAN)
            .map((part) =>
              part.startsWith('`')
                ? part
                : part
                    .split(LINK)
                    .map((piece) => (LINK.test(piece) ? piece : wrapPlain(piece)))
                    .join('')
            )
            .join('')
    )
    .join('');
}
