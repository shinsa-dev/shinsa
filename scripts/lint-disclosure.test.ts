import { describe, expect, test } from 'bun:test';
import {
  DISCLOSURE_HEADER_MESSAGE,
  FOLD_STATE_MESSAGE,
  listDisclosureViolations,
  PERSIST_ID_MESSAGE,
} from './lint-disclosure.ts';

const messages = (source: string) => listDisclosureViolations(source).map((violation) => violation.message);

describe('every collapsible remembers whether it is open', () => {
  test('a collapsible primitive without persistId is caught', () => {
    expect(messages("const a = <Panel title='Summary' icon='IconNote1'>x</Panel>;")).toEqual([
      PERSIST_ID_MESSAGE,
    ]);
    expect(messages('const a = <ExpandRow {...parts}>x</ExpandRow>;')).toEqual([PERSIST_ID_MESSAGE]);
  });

  test('a primitive with an id or an opt-out passes, and other elements are left alone', () => {
    expect(messages("const a = <Panel persistId={id} title='Summary'>x</Panel>;")).toEqual([]);
    expect(messages("const a = <ReviewNote persistId={notPersisted('a finding')} item={item} />;")).toEqual(
      []
    );
    expect(messages('const a = <section><Tabs.List /></section>;')).toEqual([]);
  });

  test('a DisclosureHeader needs a disclosure', () => {
    expect(
      messages('const a = <DisclosureHeader open={open} onToggle={toggle}>x</DisclosureHeader>;')
    ).toEqual([DISCLOSURE_HEADER_MESSAGE]);
    expect(messages('const a = <DisclosureHeader disclosure={disclosure}>x</DisclosureHeader>;')).toEqual([]);
  });

  test('fold state in useState is caught where the file folds something', () => {
    const folding = [
      'function Row() {',
      '  const [open, setOpen] = React.useState(false);',
      '  return <button aria-expanded={open} onClick={() => setOpen(!open)} />;',
      '}',
    ].join('\n');
    expect(listDisclosureViolations(folding)).toEqual([{ line: 2, message: FOLD_STATE_MESSAGE }]);
    const header = [
      'function Row({ disclosure }) {',
      '  const [expanded, setExpanded] = useState(false);',
      '  return <DisclosureHeader disclosure={disclosure}>x</DisclosureHeader>;',
      '}',
    ].join('\n');
    expect(messages(header)).toEqual([FOLD_STATE_MESSAGE]);
    const both = [
      'function Row() {',
      '  const [folded, setFolded] = useState(false);',
      "  return <Panel title='x'><button aria-expanded={folded} /></Panel>;",
      '}',
    ].join('\n');
    expect(listDisclosureViolations(both).map((violation) => violation.line)).toEqual([2, 3]);
  });

  test('a popover’s open state, other state and a file that folds nothing pass', () => {
    const popover = [
      'function Menu() {',
      '  const [open, setOpen] = React.useState(false);',
      '  const [draft] = useState("");',
      '  const [count, setCount] = useState(0);',
      '  const value = compute();',
      '  const { a } = useState(1);',
      '  const [first] = other();',
      '  return <Popover open={open} onOpenChange={setOpen} />;',
      '}',
    ].join('\n');
    expect(messages(popover)).toEqual([]);
    expect(
      messages('const run = (fn) => fn();\nconst [open] = run(useState);\nconst [shut] = (0, useState)();')
    ).toEqual([]);
  });
});
