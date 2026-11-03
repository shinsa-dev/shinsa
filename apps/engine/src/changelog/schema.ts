import { Changelog } from '@shinsa/core';
import { Schema } from 'effect';

export const BuiltChangelog = Schema.fromJsonString(Changelog);

export const EMPTY_CHANGELOG: Changelog = { releases: [] };

export interface ChangelogSource {
  built: string | undefined;
  root: string | null;
}
