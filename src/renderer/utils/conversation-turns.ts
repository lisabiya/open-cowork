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

export interface SplitAssistantTurnOptions {
  isProcessing?: boolean;
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

function isProcessBlock(block: ContentBlock, toolUseIds: Set<string>): boolean {
  if (block.type === 'thinking' || block.type === 'tool_use') {
    return true;
  }

  return block.type === 'tool_result' && !toolUseIds.has((block as ToolResultContent).toolUseId);
}

function isFinalEligibleBlock(block: ContentBlock): boolean {
  return block.type !== 'thinking' && block.type !== 'tool_use' && block.type !== 'tool_result';
}

export function splitAssistantTurnMessages(
  messages: Message[],
  options: SplitAssistantTurnOptions = {}
): AssistantTurnContent {
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
  const finalMessageMap = new Map<string, AssistantFinalMessage>();
  const entries = messages.flatMap((message) => {
    const allBlocks = getMessageRenderableBlocks(message);
    return allBlocks.map((block) => ({
      block,
      message,
      allBlocks,
      isProcess: isProcessBlock(block, toolUseIds),
      isFinalEligible: isFinalEligibleBlock(block),
    }));
  });

  let lastProcessIndex = -1;
  entries.forEach((entry, index) => {
    if (entry.isProcess) {
      lastProcessIndex = index;
    }
  });

  entries.forEach((entry, index) => {
    const shouldHoldFinalDuringProcessing = options.isProcessing && lastProcessIndex !== -1;
    const shouldRenderAsFinal =
      entry.isFinalEligible &&
      !shouldHoldFinalDuringProcessing &&
      (lastProcessIndex === -1 || index > lastProcessIndex);

    if (shouldRenderAsFinal) {
      const finalMessage = finalMessageMap.get(entry.message.id);
      if (finalMessage) {
        finalMessage.contentBlocks.push(entry.block);
      } else {
        finalMessageMap.set(entry.message.id, {
          message: entry.message,
          contentBlocks: [entry.block],
        });
      }
      return;
    }

    if (entry.isProcess || entry.isFinalEligible) {
      processItems.push({
        block: entry.block,
        message: entry.message,
        allBlocks: entry.allBlocks,
      });
    }
  });

  return { processItems, finalMessages: Array.from(finalMessageMap.values()) };
}
