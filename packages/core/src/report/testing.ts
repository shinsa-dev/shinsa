import { parseReference, REFERENCE_SCHEME } from '../chat/references.ts';
import type { ManualTestStep, ManualTestTargetKind, ReportTesting } from './types.ts';

export const MANUAL_TEST_TARGETS: readonly [ManualTestTargetKind, ...ManualTestTargetKind[]] = [
  'url',
  'file',
  'command',
  'screen',
];

export interface TestFile {
  path: string;
  line: number | null;
  end: number | null;
}

const WEB_URL = /^https?:\/\/\S+$/i;

const LINE_SUFFIX = /^(.+?):(\d+)(?:-(\d+))?$/;

export function createTesting(automated: string[] = []): ReportTesting {
  return { automated, manual: [] };
}

export function hasTesting(testing: ReportTesting | null | undefined) {
  return (testing?.automated.length ?? 0) > 0 || (testing?.manual.length ?? 0) > 0;
}

export function isWebUrl(value: string) {
  return WEB_URL.test(value.trim());
}

function resolveFileHref(text: string) {
  if (text.slice(0, REFERENCE_SCHEME.length).toLowerCase() === REFERENCE_SCHEME) return text;
  const match = LINE_SUFFIX.exec(text);
  if (!match) return `${REFERENCE_SCHEME}file/${text}`;
  return `${REFERENCE_SCHEME}file/${match[1]}#L${match[2]}${match[3] ? `-L${match[3]}` : ''}`;
}

export function parseTestFile(value: string): TestFile | null {
  const reference = parseReference(resolveFileHref(value.trim()));
  if (reference?.kind !== 'file') return null;
  return { path: reference.path, line: reference.line, end: reference.end };
}

export function serializeTestFile(file: TestFile) {
  if (file.line === null) return file.path;
  return `${file.path}:${file.line}${file.end === null ? '' : `-${file.end}`}`;
}

function describeManualStep(step: ManualTestStep, index: number) {
  const target = step.target ? ` [${step.target.kind}: ${step.target.value}]` : '';
  return `${index + 1}. ${step.action}${target} Expected: ${step.expect}`;
}

export function listTestingLines(testing: ReportTesting | null | undefined) {
  const automated = testing?.automated ?? [];
  const manual = testing?.manual ?? [];
  return [
    ...(automated.length > 0 ? ['Covered by tests:', ...automated.map((line) => `- ${line}`)] : []),
    ...(manual.length > 0 ? ['Try it yourself:', ...manual.map(describeManualStep)] : []),
  ];
}
