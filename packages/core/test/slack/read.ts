import type { SlackBlock, SlackMessage } from '../../src/index.ts';

export function readBlockText(block: SlackBlock): string {
  switch (block.type) {
    case 'header':
      return block.text.text;
    case 'section':
      return 'text' in block ? block.text.text : block.fields.map((field) => field.text).join('\n');
    case 'context':
      return block.elements.map((element) => element.text).join('  ');
    case 'actions':
      return block.elements
        .map((button) => (button.url ? `<${button.url}|${button.text.text}>` : `[${button.text.text}]`))
        .join('  ');
  }
}

export function readMessageText(message: SlackMessage) {
  return message.blocks.map(readBlockText).join('\n');
}
