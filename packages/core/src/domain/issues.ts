import { Match, Predicate, type SchemaIssue } from 'effect';

const ROOT_LABEL = 'The input';

const INVALID = '{path} is not valid.';

interface IssueEntry {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

function selectMessage(annotations: { readonly [key: string]: unknown } | undefined, key = 'message') {
  const message = annotations?.[key];
  return Predicate.isString(message) ? message : null;
}

function resolveLeafMessage(issue: SchemaIssue.Leaf) {
  switch (issue._tag) {
    case 'MissingKey':
      return selectMessage(issue.annotations, 'messageMissingKey') ?? '{path} is required.';
    case 'UnexpectedKey':
      return selectMessage(issue.ast.annotations, 'messageUnexpectedKey') ?? '{path} is not a known field.';
    case 'InvalidType':
    case 'OneOf':
      return selectMessage(issue.ast.annotations) ?? INVALID;
    case 'InvalidValue':
    case 'Forbidden':
      return selectMessage(issue.annotations) ?? INVALID;
  }
}

function listEntries(issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): IssueEntry[] {
  const leaf = (found: SchemaIssue.Leaf): IssueEntry[] => [{ path, message: resolveLeafMessage(found) }];
  return Match.value(issue).pipe(
    Match.tagsExhaustive({
      Pointer: (pointer) => listEntries(pointer.issue, [...path, ...pointer.path]),
      Composite: (composite) => composite.issues.flatMap((child) => listEntries(child, path)),
      Encoding: (encoding) => listEntries(encoding.issue, path),
      Filter: (filter) => {
        const own = selectMessage(filter.filter.annotations);
        if (own !== null) return [{ path, message: own }];
        return listEntries(filter.issue, path);
      },
      AnyOf: (anyOf) => {
        if (anyOf.issues.length > 0) return anyOf.issues.flatMap((child) => listEntries(child, path));
        return [{ path, message: selectMessage(anyOf.ast.annotations) ?? INVALID }];
      },
      InvalidType: leaf,
      InvalidValue: leaf,
      MissingKey: leaf,
      UnexpectedKey: leaf,
      Forbidden: leaf,
      OneOf: leaf,
    })
  );
}

export function resolveIssuePath(path: ReadonlyArray<PropertyKey>) {
  if (path.length === 0) return ROOT_LABEL;
  return path
    .map((segment, index) => {
      if (Predicate.isNumber(segment)) return `[${segment}]`;
      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join('');
}

function resolveIssueKey(path: ReadonlyArray<PropertyKey>) {
  const key = path.filter((segment) => !Predicate.isNumber(segment)).at(-1);
  return key === undefined ? ROOT_LABEL : String(key);
}

export function listIssueMessages(issue: SchemaIssue.Issue) {
  return listEntries(issue, []).map(({ path, message }) =>
    message.replaceAll('{path}', resolveIssuePath(path)).replaceAll('{key}', resolveIssueKey(path))
  );
}
