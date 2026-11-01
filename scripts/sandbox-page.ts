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

function serializeText(text: string) {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

function serializeSection(section: SandboxSection) {
  const links = section.links
    .map(
      (link) =>
        `<li><a href="${serializeText(link.url)}">${serializeText(link.label)}</a><code>${serializeText(link.url)}</code></li>`
    )
    .join('');
  return `<section><h2>${serializeText(section.title)}</h2><ul>${links}</ul></section>`;
}

export function serializeSandboxPage(sections: SandboxSection[]) {
  const shown = sections.filter((section) => section.links.length > 0);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Shinsa sandbox</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:48px auto;max-width:720px;padding:0 24px;color:#1c1b19;background:#faf9f7}
h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 32px;color:#6b6862}
h2{font-size:13px;font-weight:600;margin:28px 0 8px;color:#6b6862}
ul{list-style:none;margin:0;padding:0;border:1px solid #e7e4df;border-radius:10px;background:#fff}
li{padding:10px 14px;border-top:1px solid #e7e4df;display:flex;flex-direction:column;gap:2px}
li:first-child{border-top:0}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
code{font:12px ui-monospace,monospace;color:#8a867f;word-break:break-all}
@media (prefers-color-scheme:dark){body{color:#ecebe8;background:#151413}p,h2{color:#a29e97}ul{border-color:#2c2a27;background:#1d1c1a}li{border-color:#2c2a27}a{color:#60a5fa}code{color:#7d7972}}
</style>
<h1>Shinsa sandbox</h1>
<p>Two seeded machines, Studio and Laptop, behind a local stand-in for app.shinsa.dev. Commands work and no agent runs; each start seeds them again.</p>
${shown.map(serializeSection).join('\n')}
</html>`;
}
