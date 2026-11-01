export type PreviewPageKind = 'gone' | 'stopped' | 'offline';

export const PREVIEW_GONE = 'This preview is no longer shared, or the link is wrong.';

export const PREVIEW_STOPPED =
  'This page reloads by itself once the service behind this preview starts again.';

export const PREVIEW_OFFLINE =
  'This page reloads by itself once the machine that shares this preview is back online.';

export const PREVIEW_RETRY_SECONDS = 10;

const SHINSA_SITE = 'https://shinsa.dev';

const SHINSA_MARK =
  '<svg viewBox="0 0 365 365" fill="currentColor" aria-hidden="true"><path d="M365 131.088C365 154.197 342.028 170.637 318.919 170.637C237.025 170.637 170.637 237.025 170.637 318.919C170.637 342.028 154.197 365 131.088 365H58.4C37.9581 365 27.7371 365 19.9293 361.022C13.0614 357.522 7.47764 351.939 3.97826 345.071C0 337.263 0 327.042 0 306.6V233.911C0 210.802 22.9719 194.363 46.0813 194.363C127.975 194.363 194.363 127.975 194.363 46.0813C194.363 22.972 210.803 0 233.912 0H306.6C327.042 0 337.263 0 345.071 3.97826C351.939 7.47764 357.522 13.0614 361.022 19.9293C365 27.7371 365 37.9581 365 58.4V131.088Z"/><path d="M318.919 204.856C322.081 204.856 325.213 204.985 328.31 205.237C335.924 205.858 339.732 206.169 346.895 210.348C351.769 213.192 358.978 221.013 361.416 226.102C365 233.581 365 239.914 365 252.581V306.6C365 327.042 365 337.263 361.022 345.071C357.522 351.939 351.939 357.522 345.071 361.022C337.263 365 327.042 365 306.6 365H252.581C239.914 365 233.581 365 226.102 361.416C221.013 358.978 213.192 351.769 210.348 346.895C206.169 339.732 205.858 335.924 205.237 328.31C204.985 325.213 204.856 322.081 204.856 318.919C204.856 255.924 255.924 204.856 318.919 204.856Z"/><path d="M112.419 0C125.086 0 131.419 0 138.898 3.58359C143.988 6.02224 151.808 13.2309 154.652 18.1053C158.831 25.2683 159.142 29.0757 159.763 36.6903C160.015 39.7872 160.144 42.9192 160.144 46.0813C160.144 109.076 109.076 160.144 46.0813 160.144C42.9191 160.144 39.787 160.015 36.69 159.762C29.0752 159.141 25.2678 158.831 18.1049 154.652C13.2305 151.807 6.02212 143.987 3.58351 138.898C0 131.419 0 125.085 0 112.418V58.4C0 37.9581 0 27.7371 3.97826 19.9293C7.47764 13.0614 13.0614 7.47764 19.9293 3.97826C27.7371 0 37.9581 0 58.4 0H112.419Z"/></svg>';

const ICON_EYE_SLASH =
  '<path d="M10.7424 5.08581C14.5545 4.56441 18.5221 6.42082 21.2263 10.6551C21.7501 11.4753 21.7503 12.5244 21.2265 13.3446C20.932 13.8057 20.6226 14.2386 20.3 14.6434" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.70711 2.29289C3.31658 1.90237 2.68342 1.90237 2.29289 2.29289C1.90237 2.68342 1.90237 3.31658 2.29289 3.70711L3.70711 2.29289ZM20.2929 21.7071C20.6834 22.0976 21.3166 22.0976 21.7071 21.7071C22.0976 21.3166 22.0976 20.6834 21.7071 20.2929L20.2929 21.7071ZM2.29289 3.70711L20.2929 21.7071L21.7071 20.2929L3.70711 2.29289L2.29289 3.70711Z" fill="currentColor"/><path d="M10.3327 10.8948C10.6385 10.4349 10.5136 9.81418 10.0537 9.50839C9.59377 9.20261 8.97305 9.32755 8.66727 9.78745L10.3327 10.8948ZM14.2126 15.3328C14.6725 15.027 14.7974 14.4063 14.4916 13.9463C14.1858 13.4864 13.5651 13.3615 13.1052 13.6673L14.2126 15.3328ZM12 14C10.8954 14 10 13.1046 10 12H8C8 14.2092 9.79086 16 12 16V14ZM10 12C10 11.5897 10.1225 11.211 10.3327 10.8948L8.66727 9.78745C8.24565 10.4216 8 11.1836 8 12H10ZM13.1052 13.6673C12.789 13.8775 12.4103 14 12 14V16C12.8164 16 13.5785 15.7544 14.2126 15.3328L13.1052 13.6673Z" fill="currentColor"/><path d="M6.12804 7C4.8897 7.90878 3.74923 9.12726 2.77333 10.6554C2.24952 11.4757 2.25027 12.5258 2.77416 13.346C6.35039 18.9448 12.1359 20.3855 16.8491 17.6681" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

const ICON_STOP =
  '<path d="M20 15.2V8.8C20 7.11984 20 6.27976 19.673 5.63803C19.3854 5.07354 18.9265 4.6146 18.362 4.32698C17.7202 4 16.8802 4 15.2 4H8.8C7.11984 4 6.27976 4 5.63803 4.32698C5.07354 4.6146 4.6146 5.07354 4.32698 5.63803C4 6.27976 4 7.11984 4 8.8V15.2C4 16.8802 4 17.7202 4.32698 18.362C4.6146 18.9265 5.07354 19.3854 5.63803 19.673C6.27976 20 7.11984 20 8.8 20H15.2C16.8802 20 17.7202 20 18.362 19.673C18.9265 19.3854 19.3854 18.9265 19.673 18.362C20 17.7202 20 16.8802 20 15.2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

const ICON_CLOUD_DISCONNECTED =
  '<path d="M5 17.7453C3.18652 16.4804 2 14.3787 2 12C2 8.13401 5.13401 5 9 5C11.5628 5 13.8039 6.37723 15.0236 8.43195C15.2884 8.87791 15.8167 9.11316 16.3308 9.0444C16.5497 9.01512 16.7731 9 17 9C19.7614 9 22 11.2386 22 14C22 16.0503 20.7659 17.8124 19 18.584" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 16L12 18M12 18L10 20M12 18L10 16M12 18L14 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

interface PreviewPage {
  title: string;
  description: string;
  icon: string;
  retry: boolean;
}

export const PREVIEW_PAGES: Readonly<Record<PreviewPageKind, PreviewPage>> = {
  gone: {
    title: 'This preview is not shared',
    description: PREVIEW_GONE,
    icon: ICON_EYE_SLASH,
    retry: false,
  },
  stopped: {
    title: 'The service is not running',
    description: PREVIEW_STOPPED,
    icon: ICON_STOP,
    retry: true,
  },
  offline: {
    title: 'The machine is offline',
    description: PREVIEW_OFFLINE,
    icon: ICON_CLOUD_DISCONNECTED,
    retry: true,
  },
};

const PREVIEW_PAGE_STYLE = [
  ':root{color-scheme:light dark;--background:oklch(1 0 0);--bg-2:oklch(.973 .001 286.38);--bg-3:oklch(.955 .002 247.84);--bg-4:oklch(.928 .003 264.54);--fg-2:oklch(.543 .009 278.5);--fg-3:oklch(.443 .008 277);--fg-4:oklch(.21 .008 274.53)}',
  '@media (prefers-color-scheme:dark){:root{--background:oklch(.174 .004 285.97);--bg-2:oklch(.228 .006 285.93);--bg-3:oklch(.257 .006 286);--bg-4:oklch(.299 .007 285.96);--fg-2:oklch(.655 .009 286.15);--fg-3:oklch(.787 .007 286.24);--fg-4:oklch(.946 .001 286.37)}}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100dvh;display:flex;flex-direction:column;background:var(--background);color:var(--fg-3);font-family:"ABC Areal",ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:-.02em;-webkit-font-smoothing:antialiased}',
  'header{display:flex;align-items:center;height:44px;padding:0 20px}',
  'header a{display:flex;align-items:center;gap:6px;color:var(--fg-4);font-size:14px;font-weight:500;text-decoration:none}',
  'header a span{display:grid;place-items:center;width:20px;height:20px}',
  'header svg{width:13px;height:13px}',
  'main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 32px 76px;text-align:center}',
  '.media{position:relative;width:36px;height:36px;margin-bottom:4px}',
  '.media i{position:absolute;inset:0;bottom:1px;border-radius:9px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--bg-3);scale:.88}',
  '.media i:first-child{transform-origin:bottom left;translate:-6px 0;rotate:-12deg}',
  '.media i:nth-child(2){transform-origin:bottom right;translate:6px 0;rotate:12deg}',
  '.media b{position:relative;display:grid;place-items:center;width:100%;height:100%;border-radius:9px;background:var(--bg-2);box-shadow:inset 0 0 0 1px var(--bg-4);color:var(--fg-3)}',
  '.media svg{width:20px;height:20px}',
  'h1{margin:0;font-size:14px;font-weight:500;line-height:1.25;color:var(--fg-4);text-wrap:balance}',
  '.text{display:flex;flex-direction:column;gap:1px}',
  'p{margin:0;max-width:28rem;font-size:13px;line-height:1.2;color:var(--fg-2);text-wrap:pretty}',
].join('');

export function serializePreviewPage(kind: PreviewPageKind) {
  const page = PREVIEW_PAGES[kind];
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    page.retry ? `<meta http-equiv="refresh" content="${PREVIEW_RETRY_SECONDS}">` : '',
    `<title>${page.title} · Shinsa</title>`,
    `<style>${PREVIEW_PAGE_STYLE}</style>`,
    '</head><body>',
    `<header><a href="${SHINSA_SITE}"><span>${SHINSA_MARK}</span>Shinsa</a></header>`,
    '<main><div class="media" aria-hidden="true"><i></i><i></i>',
    `<b><svg viewBox="0 0 24 24" fill="none">${page.icon}</svg></b></div>`,
    `<div class="text"><h1>${page.title}</h1><p>${page.description}</p></div></main>`,
    '</body></html>',
  ].join('');
}
