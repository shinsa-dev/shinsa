import { Option, Schema } from 'effect';
import { resolveRefusedReply } from './endpoint.ts';
import {
  type AgentMessage,
  AttachedToTarget,
  type BrowserMessage,
  CDP_SERVER_ERROR,
  CdpCommand,
  CdpMessage,
  CreatedTarget,
  FIRST_PROXY_COMMAND_ID,
  FOREIGN_PAGE_MESSAGE,
  FOREIGN_TARGET_METHODS,
  type HeldPage,
  PAGE_TARGET,
  TARGET_EVENTS,
  TargetEventParams,
  TargetInfo,
  type TargetFilter,
  TargetList,
} from './schema.ts';

const decodeCommand = Schema.decodeUnknownOption(CdpCommand);
const decodeMessage = Schema.decodeUnknownOption(CdpMessage);
const decodeAttached = Schema.decodeUnknownOption(AttachedToTarget);
const decodeEvent = Schema.decodeUnknownOption(TargetEventParams);
const decodeCreated = Schema.decodeUnknownOption(CreatedTarget);
const decodeList = Schema.decodeUnknownOption(TargetList);
const decodeInfo = Schema.decodeUnknownOption(TargetInfo);

const PASS: BrowserMessage = { toAgent: [], toBrowser: [] };

export function createTargetFilter(): TargetFilter {
  const owned = new Set<string>();
  const foreign = new Set<string>();
  const pendingCreates = new Set<number>();
  const pendingLists = new Set<number>();
  const proxyCommands = new Set<number>();
  const held = new Map<string, HeldPage>();
  let nextCommandId = FIRST_PROXY_COMMAND_ID;

  const sendForAgent = (method: string, sessionId: string | undefined, params?: object) => {
    const id = nextCommandId++;
    proxyCommands.add(id);
    return JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) });
  };

  const letGo = (page: Pick<HeldPage, 'targetId' | 'sessionId' | 'waiting'>) => {
    foreign.add(page.targetId);
    return [
      ...(page.waiting ? [sendForAgent('Runtime.runIfWaitingForDebugger', page.sessionId)] : []),
      sendForAgent('Target.detachFromTarget', undefined, { sessionId: page.sessionId }),
    ];
  };

  const releaseHeld = () => {
    if (pendingCreates.size > 0) return [];
    const pages = [...held.values()];
    held.clear();
    return pages.flatMap(letGo);
  };

  const isOwnedPage = (targetId: string, openerId: string | undefined) =>
    owned.has(targetId) || (openerId !== undefined && owned.has(openerId));

  const onAttached = (text: string, params: unknown): BrowserMessage => {
    const attached = Option.getOrNull(decodeAttached(params));
    if (!attached || attached.targetInfo.type !== PAGE_TARGET) return { toAgent: [text], toBrowser: [] };
    const { targetId, openerId } = attached.targetInfo;
    if (isOwnedPage(targetId, openerId)) {
      owned.add(targetId);
      return { toAgent: [text], toBrowser: [] };
    }
    const page = { targetId, sessionId: attached.sessionId, waiting: attached.waitingForDebugger === true };
    if (pendingCreates.size > 0) {
      held.set(targetId, { ...page, messages: [text] });
      return PASS;
    }
    return { toAgent: [], toBrowser: letGo(page) };
  };

  const onTargetEvent = (text: string, params: unknown): BrowserMessage => {
    const event = Option.getOrNull(decodeEvent(params));
    const targetId = event?.targetInfo?.targetId ?? event?.targetId;
    if (targetId === undefined) return { toAgent: [text], toBrowser: [] };
    if (foreign.has(targetId) || held.has(targetId)) return PASS;
    if (event?.targetInfo?.type === PAGE_TARGET && !isOwnedPage(targetId, event.targetInfo.openerId)) {
      return PASS;
    }
    return { toAgent: [text], toBrowser: [] };
  };

  const onCreated = (text: string, id: number, result: unknown): BrowserMessage => {
    pendingCreates.delete(id);
    const created = Option.getOrNull(decodeCreated(result));
    const page = created ? held.get(created.targetId) : undefined;
    if (created) owned.add(created.targetId);
    if (page) held.delete(page.targetId);
    return { toAgent: [...(page?.messages ?? []), text], toBrowser: releaseHeld() };
  };

  const onList = (text: string, message: CdpMessage, id: number): BrowserMessage => {
    pendingLists.delete(id);
    const list = Option.getOrNull(decodeList(message.result));
    if (!list) return { toAgent: [text], toBrowser: [] };
    const targetInfos = list.targetInfos.filter((item) => {
      const info = Option.getOrNull(decodeInfo(item));
      return !info || info.type !== PAGE_TARGET || isOwnedPage(info.targetId, info.openerId);
    });
    return { toAgent: [JSON.stringify({ ...message, result: { ...list, targetInfos } })], toBrowser: [] };
  };

  const selectHeldSession = (sessionId: string) =>
    [...held.values()].find((page) => page.sessionId === sessionId);

  const fromBrowser = (text: string): BrowserMessage => {
    const message = Option.getOrNull(decodeMessage(text));
    if (!message) return { toAgent: [text], toBrowser: [] };
    const { id, method, sessionId } = message;
    if (id !== undefined && proxyCommands.delete(id)) return PASS;
    if (id !== undefined && pendingCreates.has(id)) return onCreated(text, id, message.result);
    if (id !== undefined && pendingLists.has(id)) return onList(text, message, id);
    if (sessionId !== undefined) {
      const page = selectHeldSession(sessionId);
      if (page) {
        page.messages.push(text);
        return PASS;
      }
      return { toAgent: [text], toBrowser: [] };
    }
    if (method === 'Target.attachedToTarget') return onAttached(text, message.params);
    if (method !== undefined && TARGET_EVENTS.has(method)) return onTargetEvent(text, message.params);
    return { toAgent: [text], toBrowser: [] };
  };

  const refuseForeign = (id: number, sessionId: string | undefined) =>
    JSON.stringify({
      id,
      ...(sessionId === undefined ? {} : { sessionId }),
      error: { code: CDP_SERVER_ERROR, message: FOREIGN_PAGE_MESSAGE },
    });

  const fromAgent = (text: string): AgentMessage => {
    const refused = resolveRefusedReply(text);
    if (refused) return { forward: null, reply: refused };
    if (!text.includes('"Target.')) return { forward: text, reply: null };
    const command = Option.getOrNull(decodeCommand(text));
    if (!command || command.sessionId !== undefined) return { forward: text, reply: null };
    if (command.method === 'Target.createTarget') pendingCreates.add(command.id);
    if (command.method === 'Target.getTargets') pendingLists.add(command.id);
    if (FOREIGN_TARGET_METHODS.has(command.method)) {
      const targetId = Option.getOrNull(decodeEvent(command.params))?.targetId;
      if (targetId !== undefined && foreign.has(targetId)) {
        return { forward: null, reply: refuseForeign(command.id, command.sessionId) };
      }
    }
    return { forward: text, reply: null };
  };

  return { fromAgent, fromBrowser };
}
