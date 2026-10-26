import { MCP_SIGN_IN_CHANNEL } from '@shinsa/core';

export const SIGN_IN_CALLBACK_PATH = '/api/mcp/oauth/callback';

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function serializeSignInPage(title: string, body: string, ok: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>*,*::before,*::after{box-sizing:border-box}body{font:14px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#222}
@media (prefers-color-scheme:dark){body{background:#1b1b1d;color:#eee}}main{max-width:32rem;padding:2rem}
h1{font-size:15px;font-weight:500;margin:0 0 4px}p{margin:0;opacity:.7}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main>
<script>try{new BroadcastChannel(${JSON.stringify(MCP_SIGN_IN_CHANNEL)}).postMessage(${JSON.stringify({ ok })})}catch{}try{window.opener&&window.opener.postMessage(${JSON.stringify({ channel: MCP_SIGN_IN_CHANNEL, ok })},'*')}catch{}${ok ? 'setTimeout(()=>window.close(),1500)' : ''}</script>
</body></html>`;
}
