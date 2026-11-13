import type { ShareLiveView, TeamInitiative, TeamListView, TeamTask } from '@shinsa/core';
import { Schema } from 'effect';
import { EgressView, PREVIEW_DROPPED_HEADERS, TeamInitiatives, TeamTasks } from './schema.ts';

export const EgressGate = {
  serializeView(view: ShareLiveView | TeamListView): string {
    return Schema.encodeUnknownSync(EgressView)(view);
  },
  listTeamTasks(tasks: readonly TeamTask[]): TeamTask[] {
    const listed: readonly unknown[] = Schema.encodeUnknownSync(TeamTasks)(tasks);
    return listed as TeamTask[];
  },
  listTeamInitiatives(initiatives: readonly TeamInitiative[]): TeamInitiative[] {
    const listed: readonly unknown[] = Schema.encodeUnknownSync(TeamInitiatives)(initiatives);
    return listed as TeamInitiative[];
  },
  resolvePreviewHeaders(source: Headers, localOrigins: readonly string[]): Headers {
    const headers = new Headers();
    for (const [name, value] of source) if (!PREVIEW_DROPPED_HEADERS.has(name)) headers.append(name, value);
    const location = headers.get('location');
    for (const prefix of localOrigins) {
      if (location?.startsWith(prefix)) headers.set('location', location.slice(prefix.length) || '/');
    }
    return headers;
  },
};
