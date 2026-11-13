import { INITIATIVE_LIMITS } from '../domain/index.ts';
import { HandOverRecord, Required } from '../report/reading.ts';

export const InitiativeReportInput = HandOverRecord({
  narrative: Required(INITIATIVE_LIMITS.narrative),
});
