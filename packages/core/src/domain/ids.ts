import { type Brand, Schema } from 'effect';
import { Id } from './fields.ts';

export const IdText = Id();

export const TaskId = IdText.pipe(Schema.brand('TaskId'));

export type TaskId = typeof TaskId.Type;

export const RunId = IdText.pipe(Schema.brand('RunId'));

export type RunId = typeof RunId.Type;

export const GateId = IdText.pipe(Schema.brand('GateId'));

export type GateId = typeof GateId.Type;

export const ProjectId = IdText.pipe(Schema.brand('ProjectId'));

export type ProjectId = typeof ProjectId.Type;

export const RepoId = IdText.pipe(Schema.brand('RepoId'));

export type RepoId = typeof RepoId.Type;

export const ScheduleId = IdText.pipe(Schema.brand('ScheduleId'));

export type ScheduleId = typeof ScheduleId.Type;

export const SuggestionId = IdText.pipe(Schema.brand('SuggestionId'));

export type SuggestionId = typeof SuggestionId.Type;

export const FeedbackId = IdText.pipe(Schema.brand('FeedbackId'));

export type FeedbackId = typeof FeedbackId.Type;

export const WatchdogId = IdText.pipe(Schema.brand('WatchdogId'));

export type WatchdogId = typeof WatchdogId.Type;

export const ServiceId = IdText.pipe(Schema.brand('ServiceId'));

export type ServiceId = typeof ServiceId.Type;

export const MemoryId = IdText.pipe(Schema.brand('MemoryId'));

export type MemoryId = typeof MemoryId.Type;

export type Unbranded<T> =
  T extends Brand.Brand<string>
    ? Brand.Brand.Unbranded<T>
    : T extends object
      ? { [Key in keyof T]: Unbranded<T[Key]> }
      : T;
