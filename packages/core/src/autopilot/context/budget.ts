import {
  AUTOPILOT_CONTEXT_LIMITS,
  AUTOPILOT_CONTEXT_NAMES,
  AUTOPILOT_CONTEXT_SECTIONS,
  type AutopilotContextSection,
} from './schema.ts';

export function clipAutopilotText(text: string, limit: number) {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function fitLines(lines: readonly string[], cap: number) {
  const fitted: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > cap) break;
    fitted.push(line);
    used += line.length + 1;
  }
  return fitted;
}

function renderSection(section: AutopilotContextSection) {
  return ['', section.title, ...section.lines];
}

function measure(lines: readonly string[]) {
  return lines.reduce((total, line) => total + line.length + 1, 0);
}

function describeLeftOut(cut: readonly AutopilotContextSection[]) {
  if (cut.length === 0) return [];
  return ['', `Left out to fit: ${cut.map((section) => AUTOPILOT_CONTEXT_NAMES[section.name]).join(', ')}.`];
}

export function resolveAutopilotContextLines(sections: readonly AutopilotContextSection[]): string[] {
  const capped = sections
    .map((section) => ({
      ...section,
      lines: fitLines(section.lines, AUTOPILOT_CONTEXT_LIMITS.sections[section.name]),
    }))
    .filter((section) => section.lines.length > 0)
    .sort((a, b) => AUTOPILOT_CONTEXT_SECTIONS.indexOf(a.name) - AUTOPILOT_CONTEXT_SECTIONS.indexOf(b.name));
  const kept = [...capped];
  const cut: AutopilotContextSection[] = [];
  while (kept.length > 0 && measure(kept.flatMap(renderSection)) > AUTOPILOT_CONTEXT_LIMITS.budget) {
    cut.unshift(...kept.splice(-1));
  }
  return [...kept.flatMap(renderSection), ...describeLeftOut(cut)];
}
