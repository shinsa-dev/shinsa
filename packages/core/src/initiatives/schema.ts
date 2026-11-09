import { INITIATIVE_LIMITS } from '../domain/index.ts';
import { HandOverRecord, OrAbsent, Required, TextList } from '../report/reading.ts';

export const InitiativeReportInput = HandOverRecord({
  narrative: Required(INITIATIVE_LIMITS.narrative),
  questions: OrAbsent(TextList(INITIATIVE_LIMITS.questions, INITIATIVE_LIMITS.question)),
});
