import { PAGE_SLOTS, SCRIPT_CLOSE } from './schema.ts';

export function inlinePageScript(
  template: string,
  page: { script: string; marks: readonly string[]; font: string }
) {
  const marks = page.marks
    .map((path, index) => `<path class="piece" style="--piece: ${index}" d="${path}" />`)
    .join('');
  const script = `<script>${page.script.replace(SCRIPT_CLOSE, '<\\/script')}</script>`;
  const font = `src: url(data:font/woff2;base64,${page.font}) format('woff2');`;
  return template
    .replace(PAGE_SLOTS.font, () => font)
    .replace(PAGE_SLOTS.marks, () => marks)
    .replace(PAGE_SLOTS.script, () => script);
}
