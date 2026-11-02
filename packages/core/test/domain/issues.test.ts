import { describe, expect, test } from 'bun:test';
import { Result, Schema, SchemaIssue } from 'effect';
import { listIssueMessages, resolveIssuePath } from '../../src/index.ts';

function listRefusals(schema: Schema.Decoder<unknown>, value: unknown) {
  const decoded = Schema.decodeUnknownResult(schema)(value, {
    errors: 'all',
    onExcessProperty: 'error',
  });
  return Result.isFailure(decoded) ? listIssueMessages(decoded.failure.issue) : [];
}

const Text = Schema.String.annotate({ message: '{key} must be text.' });

describe('issue messages', () => {
  test('a path reads as fields joined by dots and list positions in brackets', () => {
    expect(resolveIssuePath([])).toBe('The input');
    expect(resolveIssuePath(['spots', 0, 'file'])).toBe('spots[0].file');
    expect(resolveIssuePath([2, 'why'])).toBe('[2].why');
  });

  test('each issue in a struct gives its own message in field order, {key} its field and {path} the whole path', () => {
    const Shape = Schema.Struct({
      title: Text,
      spots: Schema.Array(
        Schema.Struct({ file: Text.annotateKey({ messageMissingKey: '{path} is required.' }) })
      ),
    });
    expect(listRefusals(Shape, { title: 3, spots: [{}, { file: 4 }] })).toEqual([
      'title must be text.',
      'spots[0].file is required.',
      'file must be text.',
    ]);
  });

  test('a check reads its own message, or the message its filter returns', () => {
    const Short = Text.check(
      Schema.isMaxLength(3, { message: '{path} is longer than 3 characters.' }),
      Schema.makeFilter((value: string) => value !== 'no' || `{key} cannot be ${value}.`)
    );
    expect(listRefusals(Schema.Struct({ word: Short }), { word: 'long' })).toEqual([
      'word is longer than 3 characters.',
    ]);
    expect(listRefusals(Schema.Struct({ word: Short }), { word: 'no' })).toEqual(['word cannot be no.']);
  });

  test('a check over a record reports the field it points at', () => {
    const Range = Schema.Struct({ start: Schema.Number, end: Schema.Number }).check(
      Schema.makeFilter((range: { start: number; end: number }) =>
        range.end >= range.start
          ? undefined
          : new SchemaIssue.Pointer(
              ['end'],
              new SchemaIssue.InvalidValue({ message: '{path} comes before start.' })
            )
      )
    );
    expect(listRefusals(Schema.Struct({ spot: Range }), { spot: { start: 4, end: 2 } })).toEqual([
      'spot.end comes before start.',
    ]);
  });

  test('a union with no matching member gives its own message', () => {
    const Command = Schema.Union([
      Schema.Struct({ type: Schema.Literal('task.create') }),
      Schema.Struct({ type: Schema.Literal('task.cancel'), taskId: Text }),
    ]).annotate({ message: 'Unknown command.' });
    expect(listRefusals(Command, { type: 'task.move' })).toEqual(['Unknown command.']);
    expect(listRefusals(Command, { type: 'task.cancel', taskId: 1 })).toEqual(['taskId must be text.']);
    expect(listRefusals(Schema.Union([Schema.String, Schema.Number]), true)).toEqual([
      'The input is not valid.',
    ]);
  });

  test('a field the shape does not know is refused', () => {
    const Shape = Schema.Struct({ title: Text });
    expect(listRefusals(Shape, { title: 'a', extra: 1 })).toEqual(['extra is not a known field.']);
    const Named = Shape.annotate({ messageUnexpectedKey: '{key} is not part of a plan.' });
    expect(listRefusals(Named, { title: 'a', extra: 1 })).toEqual(['extra is not part of a plan.']);
  });

  test('issues without a message of their own fall back to the house wording', () => {
    expect(listRefusals(Schema.Struct({ count: Schema.Number }), {})).toEqual(['count is required.']);
    expect(listRefusals(Schema.Struct({ count: Schema.Number }), { count: 'a' })).toEqual([
      'count is not valid.',
    ]);
    expect(
      listRefusals(Schema.Struct({ word: Schema.String.check(Schema.isNonEmpty()) }), { word: '' })
    ).toEqual(['word is not valid.']);
    expect(listIssueMessages(new SchemaIssue.InvalidValue(undefined))).toEqual(['The input is not valid.']);
    expect(listIssueMessages(new SchemaIssue.Forbidden({ message: 'Not now.' }))).toEqual(['Not now.']);
    expect(listIssueMessages(new SchemaIssue.Forbidden(undefined))).toEqual(['The input is not valid.']);
  });

  test('a value two members of an exclusive union accept is refused', () => {
    const Either = Schema.Union([Schema.String, Schema.String], { mode: 'oneOf' });
    expect(listRefusals(Either, 'a')).toEqual(['The input is not valid.']);
    const Named = Schema.Union([Schema.String, Schema.String], { mode: 'oneOf' }).annotate({
      message: 'Ambiguous.',
    });
    expect(listRefusals(Named, 'a')).toEqual(['Ambiguous.']);
  });

  test('an encoding failure reports the issue inside it', () => {
    const Code = Schema.String.annotate({ message: '{key} must be text.' });
    const Encoded = new SchemaIssue.Encoding(
      Code.ast,
      new SchemaIssue.Pointer(['code'], new SchemaIssue.InvalidType(Code.ast))
    );
    expect(listIssueMessages(Encoded)).toEqual(['code must be text.']);
  });
});
