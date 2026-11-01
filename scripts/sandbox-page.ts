export interface SandboxLink {
  label: string;
  url: string;
}

export interface SandboxSection {
  title: string;
  links: SandboxLink[];
}

export const SANDBOX_PATH = '/sandbox';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const THEME_SCRIPT =
  "document.documentElement.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')";

const PAGE_COLUMN = 'mx-auto w-full max-w-3xl px-6';

const PAGE_TITLE = 'text-balance font-medium text-base text-fg-4 leading-tight';

const PAGE_DESCRIPTION = 'max-w-2xl text-pretty text-fg-2 text-xs';

const SECTION_LABEL = 'flex h-6 shrink-0 items-center gap-1.5 px-1 font-medium text-2xs text-fg-2 leading-4';

const SETTINGS_CARD =
  "group/card corner-superellipse/1.125 relative flex w-full flex-col overflow-hidden rounded-xl bg-card text-card-foreground after:corner-superellipse/1.125 after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--bg-3)] after:content-[''] gap-0 p-1.5";

const LINK_ROW =
  'corner-superellipse/1.125 flex min-h-10 flex-col justify-center gap-px rounded-lg px-2 py-1 hover:bg-bg-a2';

function serializeText(text: string) {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

function serializeLink(link: SandboxLink) {
  const url = serializeText(link.url);
  return `<a class="${LINK_ROW}" href="${url}"><span class="truncate text-fg-4 text-xs">${serializeText(link.label)}</span><code class="truncate font-mono text-2xs text-fg-2">${url}</code></a>`;
}

function serializeSection(section: SandboxSection) {
  return `<section class="flex flex-col gap-1"><h2 class="${SECTION_LABEL}">${serializeText(section.title)}</h2><div class="${SETTINGS_CARD}">${section.links.map(serializeLink).join('')}</div></section>`;
}

export function serializeSandboxPage(sections: SandboxSection[], stylesheet: string) {
  const shown = sections.filter((section) => section.links.length > 0);
  return `<!doctype html><html lang="en" class="font-sans antialiased"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>Shinsa sandbox</title><script>${THEME_SCRIPT}</script><link rel="stylesheet" href="${serializeText(stylesheet)}"></head>
<body class="bg-background"><main class="${PAGE_COLUMN} flex flex-col gap-6 pt-10 pb-10">
<div class="flex min-w-0 flex-col gap-px"><h1 class="${PAGE_TITLE}">Shinsa sandbox</h1><p class="${PAGE_DESCRIPTION}">Two seeded machines, Studio and Laptop, behind a local stand-in for app.shinsa.dev. Commands work and no agent runs; each start seeds them again.</p></div>
${shown.map(serializeSection).join('\n')}
</main></body></html>`;
}
