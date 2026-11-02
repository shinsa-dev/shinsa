import { Predicate, type SchemaIssue } from 'effect';

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
  switch (issue._tag) {
    case 'Pointer':
      return listEntries(issue.issue, [...path, ...issue.path]);
    case 'Composite':
      return issue.issues.flatMap((child) => listEntries(child, path));
    case 'Encoding':
      return listEntries(issue.issue, path);
    case 'Filter': {
      const own = selectMessage(issue.filter.annotations);
      if (own !== null) return [{ path, message: own }];
      return listEntries(issue.issue, path);
    }
    case 'AnyOf':
      if (issue.issues.length > 0) return issue.issues.flatMap((child) => listEntries(child, path));
      return [{ path, message: selectMessage(issue.ast.annotations) ?? INVALID }];
    default:
      return [{ path, message: resolveLeafMessage(issue) }];
  }
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
