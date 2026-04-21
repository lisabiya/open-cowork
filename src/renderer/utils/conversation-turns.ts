import type { ContentBlock, Message, ToolResultContent, ToolUseContent } from '../types';

export interface ConversationTurn {
  userMessage: Message | null;
  assistantMessages: Message[];
}

export interface AssistantProcessItem {
  block: ContentBlock;
  message: Message;
  allBlocks: ContentBlock[];
}

export interface AssistantFinalMessage {
  message: Message;
  contentBlocks: ContentBlock[];
}

export interface AssistantTurnContent {
  processItems: AssistantProcessItem[];
  finalMessages: AssistantFinalMessage[];
}

export function getMessageRenderableBlocks(message: Message): ContentBlock[] {
  const rawContent = message.content as unknown;
  return Array.isArray(rawContent)
    ? (rawContent as ContentBlock[])
    : [{ type: 'text', text: String(rawContent ?? '') } as ContentBlock];
}

export function getAssistantFinalBlocks(contentBlocks: ContentBlock[]): ContentBlock[] {
  return contentBlocks.filter(
    (block) =>
      block.type !== 'thinking' && block.type !== 'tool_use' && block.type !== 'tool_result'
  );
}

export function groupMessagesByTurn(messages: Message[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let activeTurn: ConversationTurn | null = null;

  const flush = () => {
    if (!activeTurn) return;
    turns.push(activeTurn);
    activeTurn = null;
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flush();
      activeTurn = { userMessage: message, assistantMessages: [] };
      continue;
    }

    if (!activeTurn) {
      activeTurn = { userMessage: null, assistantMessages: [message] };
      continue;
    }

    activeTurn.assistantMessages.push(message);
  }

  flush();

  return turns;
}

export function splitAssistantTurnMessages(messages: Message[]): AssistantTurnContent {
  const toolUseIds = new Set<string>();

  for (const message of messages) {
    const allBlocks = getMessageRenderableBlocks(message);
    for (const block of allBlocks) {
      if (block.type === 'tool_use') {
        toolUseIds.add((block as ToolUseContent).id);
      }
    }
  }

  const processItems: AssistantProcessItem[] = [];
  const finalMessages: AssistantFinalMessage[] = [];

  for (const message of messages) {
    const allBlocks = getMessageRenderableBlocks(message);
    const finalBlocks = getAssistantFinalBlocks(allBlocks);

    if (finalBlocks.length > 0) {
      finalMessages.push({ message, contentBlocks: finalBlocks });
    }

    for (const block of allBlocks) {
      if (block.type === 'thinking' || block.type === 'tool_use') {
        processItems.push({ block, message, allBlocks });
        continue;
      }

      if (
        block.type === 'tool_result' &&
        !toolUseIds.has((block as ToolResultContent).toolUseId)
      ) {
        processItems.push({ block, message, allBlocks });
      }
    }
  }

  return { processItems, finalMessages };
}
