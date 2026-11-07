import { Option, Schema } from 'effect';
import {
  AttachmentField,
  MessageAttachment,
  MessageBlock,
  MessageElement,
  MessageField,
  type ThreadMessage,
} from './schema.ts';

const decodeBlock = Schema.decodeUnknownOption(MessageBlock);
const decodeElement = Schema.decodeUnknownOption(MessageElement);
const decodeField = Schema.decodeUnknownOption(MessageField);
const decodeAttachment = Schema.decodeUnknownOption(MessageAttachment);
const decodeAttachmentField = Schema.decodeUnknownOption(AttachmentField);

function listDecoded<A>(
  values: ReadonlyArray<unknown> | undefined,
  decode: (value: unknown) => Option.Option<A>
) {
  return (values ?? []).flatMap((value) => Option.toArray(decode(value)));
}

function serializeLines(parts: ReadonlyArray<string | undefined>, separator: string) {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(separator);
}

function serializeInline(element: MessageElement) {
  switch (element.type) {
    case 'link':
      if (!element.url) return element.text ?? '';
      return element.text ? `<${element.url}|${element.text}>` : `<${element.url}>`;
    case 'user':
      return element.user_id ? `<@${element.user_id}>` : '';
    case 'channel':
      return element.channel_id ? `<#${element.channel_id}>` : '';
    case 'usergroup':
      return element.usergroup_id ? `<!subteam^${element.usergroup_id}>` : '';
    case 'broadcast':
      return element.range ? `<!${element.range}>` : '';
    case 'emoji':
      return element.name ? `:${element.name}:` : '';
    default:
      return element.text ?? '';
  }
}

function serializeInlines(element: MessageElement) {
  return listDecoded(element.elements, decodeElement).map(serializeInline).join('');
}

function serializeListItems(list: MessageElement) {
  const ordered = list.style === 'ordered';
  return listDecoded(list.elements, decodeElement)
    .map((item, index) => `${ordered ? `${index + 1}.` : '•'} ${serializeInlines(item).trim()}`)
    .join('\n');
}

function serializeRichText(element: MessageElement) {
  switch (element.type) {
    case 'rich_text_list':
      return serializeListItems(element);
    case 'rich_text_preformatted':
      return `\`\`\`\n${serializeInlines(element).trim()}\n\`\`\``;
    case 'rich_text_quote':
      return serializeInlines(element)
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    default:
      return serializeInlines(element);
  }
}

function serializeBlock(block: MessageBlock) {
  const text = typeof block.text === 'string' ? block.text : block.text?.text;
  switch (block.type) {
    case 'section':
      return serializeLines(
        [text, ...listDecoded(block.fields, decodeField).map((field) => field.text)],
        '\n'
      );
    case 'header':
    case 'markdown':
      return text ?? '';
    case 'context':
      return serializeLines(listDecoded(block.elements, decodeElement).map(serializeInline), ' ');
    case 'rich_text':
      return serializeLines(listDecoded(block.elements, decodeElement).map(serializeRichText), '\n');
    default:
      return '';
  }
}

function serializeBlocks(blocks: ReadonlyArray<unknown> | undefined) {
  return serializeLines(listDecoded(blocks, decodeBlock).map(serializeBlock), '\n\n');
}

function serializeAttachment(attachment: typeof MessageAttachment.Type) {
  const fields = listDecoded(attachment.fields, decodeAttachmentField).map((field) =>
    serializeLines([field.title, field.value], ': ')
  );
  const body = serializeLines(
    [attachment.pretext, attachment.title, attachment.text, ...fields, serializeBlocks(attachment.blocks)],
    '\n'
  );
  return body || (attachment.fallback?.trim() ?? '');
}

export function resolveSlackMessageText(message: ThreadMessage) {
  const text = message.text?.trim() ?? '';
  const blocks = serializeBlocks(message.blocks);
  const attachments = listDecoded(message.attachments, decodeAttachment).map(serializeAttachment);
  return serializeLines([blocks.length > text.length ? blocks : text, ...attachments], '\n\n');
}
