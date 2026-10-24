import { type LoadedExtension, type LoadedExtensions, sumLoadedTokens } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { SWITCH_REASON } from '@/lib/accounts/account.ts';
import type { QuietNoticeKind, TimelineItemOf } from '@/lib/chat/timeline.ts';
import { formatTokenEstimate, resolveTokenText } from '@/lib/extensions.ts';
import { formatCount } from '@/lib/format/count.ts';

interface NoticeGroupLine {
  name: string;
  tokens: string;
}

export interface NoticeGroup {
  title: string;
  lines: NoticeGroupLine[];
  more: string | null;
}

interface NoticeLineView {
  icon: IconName;
  label: string;
  meta: string | null;
  detail: string;
  groups?: NoticeGroup[];
}

export const NOTICE_GROUP_LIMIT = 8;

const LOADED_GROUPS = [
  { key: 'servers', title: 'MCPs', one: 'MCP', many: 'MCPs' },
  { key: 'skills', title: 'Skills', one: 'skill', many: 'skills' },
  { key: 'plugins', title: 'Plugins', one: 'plugin', many: 'plugins' },
] as const;

function listNoticeLines(items: LoadedExtension[]): NoticeGroupLine[] {
  return [...items]
    .sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1))
    .slice(0, NOTICE_GROUP_LIMIT)
    .map((item) => ({ name: item.name, tokens: resolveTokenText(item.tokens) }));
}

function resolveDeferredGroup(loaded: LoadedExtensions): NoticeGroup[] {
  const deferred = loaded.deferred ?? [];
  if (deferred.length === 0) return [];
  const hidden = deferred.length - NOTICE_GROUP_LIMIT;
  return [
    {
      title: 'Left out until needed',
      lines: listNoticeLines(deferred),
      more: hidden > 0 ? `and ${hidden} more` : null,
    },
  ];
}

function describeDeferred(loaded: LoadedExtensions) {
  const count = loaded.deferred?.length ?? 0;
  return count > 0 ? `${count} left out` : null;
}

function joinMeta(parts: (string | null)[]) {
  const present = parts.filter((part): part is string => part !== null);
  return present.length > 0 ? present.join(' · ') : null;
}

function resolveExtensionsLine(loaded: LoadedExtensions): NoticeLineView {
  const present = LOADED_GROUPS.filter((group) => loaded[group.key].length > 0);
  if (present.length === 0) {
    const deferred = resolveDeferredGroup(loaded);
    return {
      icon: 'IconBlocks',
      label: 'Loaded only Shinsa’s tools',
      meta: describeDeferred(loaded),
      detail: 'No MCP, skill or plugin was turned on for this run.',
      ...(deferred.length > 0 ? { groups: deferred } : {}),
    };
  }
  const total = sumLoadedTokens(loaded);
  const counts = present
    .map((group) => formatCount(loaded[group.key].length, group.one, group.many))
    .join(', ');
  return {
    icon: 'IconBlocks',
    label: `Loaded ${counts}`,
    meta: joinMeta([total > 0 ? formatTokenEstimate(total) : null, describeDeferred(loaded)]),
    detail: 'What this run loaded at its start, with the tokens each one cost.',
    groups: [
      ...present.map((group) => {
        const items = loaded[group.key];
        const hidden = items.length - NOTICE_GROUP_LIMIT;
        return {
          title: group.title,
          lines: listNoticeLines(items),
          more: hidden > 0 ? `and ${hidden} more` : null,
        };
      }),
      ...resolveDeferredGroup(loaded),
    ],
  };
}

function describeCarried(included: number, total: number) {
  if (included < total) return `${included} of ${total} entries carried over; the oldest were left out.`;
  return total === 1 ? '1 entry carried over.' : `All ${total} entries carried over.`;
}

function resolveHandoffLine(item: TimelineItemOf<'handoff'>): NoticeLineView {
  const carried = describeCarried(item.includedEntries, item.totalEntries);
  if (item.reason === 'provider_switch') {
    return {
      icon: 'IconArrowsRepeat',
      label: 'Conversation handed over',
      meta: item.toProvider,
      detail: `From ${item.fromProvider} to ${item.toProvider}. ${carried}`,
    };
  }
  return {
    icon: 'IconArrowRotateClockwise',
    label: 'Session restored from the transcript',
    meta: null,
    detail: `The ${item.toProvider} session could not be resumed, so a new one started from the transcript. ${carried}`,
  };
}

const FAST_MODE_REASONS: Record<string, string> = {
  free: 'Fast mode needs a paid plan.',
  preference: 'Your organisation turned fast mode off.',
  extra_usage_disabled: 'Fast mode needs extra usage turned on for this account.',
  network_error: 'Claude could not check whether fast mode is allowed.',
  not_first_party: 'Fast mode only runs against the Anthropic API.',
  disabled_by_env: 'Fast mode is turned off on this machine.',
  model_not_allowed: 'This model does not run in fast mode.',
  sdk_opt_in_required: 'This Claude Code does not allow fast mode for agents.',
  pending: 'Claude was still checking fast mode when the run started.',
  tier_not_offered: 'Codex runs this model at standard speed only.',
  needs_credits: 'Fast mode needs usage credits on this account, and Shinsa never turns extra usage on.',
  credits_unknown: 'Shinsa could not tell whether this account has usage credits.',
};

function resolveFastModeLine(item: TimelineItemOf<'fast_mode'>): NoticeLineView {
  if (item.status === 'cooldown') {
    return {
      icon: 'IconSpeedMiddle',
      label: 'Fast mode paused',
      meta: null,
      detail: 'Fast mode is cooling down after a rate limit. The run continues at standard speed.',
    };
  }
  const reason = (item.reason && FAST_MODE_REASONS[item.reason]) || 'Fast mode is not available right now.';
  return {
    icon: 'IconSpeedMiddle',
    label: 'Fast mode unavailable',
    meta: null,
    detail: `${reason} The run continues at standard speed.`,
  };
}

function resolveCompactionLine(item: TimelineItemOf<'compaction'>): NoticeLineView {
  if (item.by === 'eunoe' && item.trigger === 'fold') {
    return {
      icon: 'IconLayersTwo',
      label: 'Finished turns folded',
      meta: null,
      detail:
        'Eunoe folded the finished turns to your messages, the output that mattered and the replies. The full transcript stays searchable.',
    };
  }
  if (item.by === 'eunoe') {
    return {
      icon: 'IconMinimize',
      label: 'Conversation compacted by Eunoe',
      meta: null,
      detail:
        'The context reached its limit, so Eunoe folded the finished turns instead of summarising them.',
    };
  }
  return {
    icon: 'IconBubbleText',
    label: 'Conversation compacted',
    meta: null,
    detail:
      item.trigger === 'auto'
        ? 'The context filled up, so the agent summarised the conversation.'
        : 'Summarised while the agent was idle, so the next step starts from a smaller context.',
  };
}

export function resolveNoticeLine(item: TimelineItemOf<QuietNoticeKind>): NoticeLineView {
  if (item.kind === 'account') {
    return {
      icon: 'IconArrowsRepeatRightLeft',
      label: 'Account switched',
      meta: item.email,
      detail: SWITCH_REASON[item.reason],
    };
  }
  if (item.kind === 'handoff') return resolveHandoffLine(item);
  if (item.kind === 'extensions') return resolveExtensionsLine(item);
  if (item.kind === 'fast_mode') return resolveFastModeLine(item);
  if (item.kind === 'proxy') {
    return {
      icon: 'IconCloudSimpleDisconnected',
      label: 'Eunoe unavailable',
      meta: 'Claude Code compacts this run',
      detail: `${item.detail ?? 'Eunoe did not answer.'} Shinsa tries Eunoe again in a minute.`,
    };
  }
  return resolveCompactionLine(item);
}
