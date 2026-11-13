import { HandOverReader, type Validation } from '../report/reading.ts';
import { InitiativeReportInput } from './schema.ts';

export interface InitiativeReportBody {
  narrative: string;
}

export function validateInitiativeReport(input: Record<string, unknown>): Validation<InitiativeReportBody> {
  const reader = new HandOverReader();
  const report = reader.read(InitiativeReportInput, input, []);
  return reader.result({ narrative: report.narrative });
}
