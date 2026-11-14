import { PAGE_SLOTS, SCRIPT_CLOSE } from './schema.ts';

export function inlinePageScript(template: string, page: { script: string; marks: readonly string[] }) {
  const marks = page.marks
    .map((path, index) => `<path class="piece" style="--piece: ${index}" d="${path}" />`)
    .join('');
  const script = `<script>${page.script.replace(SCRIPT_CLOSE, '<\\/script')}</script>`;
  return template.replace(PAGE_SLOTS.marks, () => marks).replace(PAGE_SLOTS.script, () => script);
}
