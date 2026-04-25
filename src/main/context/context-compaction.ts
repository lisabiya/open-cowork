import { v4 as uuidv4 } from 'uuid';
import type {
  CompactionType,
  CompactionTrigger,
  Message,
  SessionCompactionInfo,
  ToolResultContent,
  ToolUseContent,
} from '../../renderer/types';
import { estimateMessagesTokens, getStrategyThresholds } from './context-budget';

const COMPACTABLE_TOOL_NAMES = new Set(['read', 'grep', 'glob', 'bash', 'edit', 'write']);

export interface MicroCompactionResult {
  messages: Message[];
  compactedMessageCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

export interface CompactionBoundaryRecordInput {
  sessionId: string;
  summaryText: string;
  preservedTail: Message[];
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  compactType: CompactionType;
}

export interface SerializedCompactionBoundary {
  summary_text: string;
  preserved_tail: string;
  created_at: number;
}

export function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function getPreservedTailCount(trigger: CompactionTrigger): number {
  if (trigger === 'rolling') {
    return getStrategyThresholds('rolling').preservedTailCount;
  }
  return getStrategyThresholds('auto').preservedTailCount;
}

function compactToolResult(toolResult: ToolResultContent, toolName: string): ToolResultContent {
  if (toolResult.images && toolResult.images.length > 0) {
    return {
      ...toolResult,
      content: '[image]',
      images: undefined,
    };
  }

  const normalizedName = normalizeToolName(toolName);
  if (normalizedName === 'bash') {
    return {
      ...toolResult,
      content: truncateCompactedText(toolResult.content, 240, '[command output compacted]'),
    };
  }

  return {
    ...toolResult,
    content: truncateCompactedText(
      toolResult.content,
      240,
      `[${normalizedName || 'tool'} output compacted]`
    ),
  };
}

function truncateCompactedText(text: string, maxChars: number, fallback: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trimEnd()}\n...[compacted]`;
}

export function microCompactMessages(
  messages: Message[],
  preservedTailCount = 8
): MicroCompactionResult {
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  if (messages.length <= preservedTailCount) {
    return {
      messages,
      compactedMessageCount: 0,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
    };
  }

  const compactableToolUses = new Map<string, string>();
  const compactedMessages = messages.map((message, index) => {
    if (index >= messages.length - preservedTailCount) {
      return message;
    }

    let changed = false;
    const nextContent = message.content.map((block) => {
      if (block.type === 'tool_use') {
        const toolUse = block as ToolUseContent;
        if (COMPACTABLE_TOOL_NAMES.has(normalizeToolName(toolUse.name))) {
          compactableToolUses.set(toolUse.id, toolUse.name);
        }
        return block;
      }

      if (block.type !== 'tool_result') {
        return block;
      }

      const toolResult = block as ToolResultContent;
      const toolName = compactableToolUses.get(toolResult.toolUseId);
      if (!toolName) {
        return block;
      }

      changed = true;
      return compactToolResult(toolResult, toolName);
    });

    if (!changed) {
      return message;
    }

    return {
      ...message,
      content: nextContent,
    };
  });

  const compactedMessageCount = compactedMessages.reduce(
    (count, message, index) => count + (message !== messages[index] ? 1 : 0),
    0
  );
  const estimatedTokensAfter = estimateMessagesTokens(compactedMessages);

  return {
    messages: compactedMessages,
    compactedMessageCount,
    estimatedTokensBefore,
    estimatedTokensAfter,
  };
}

export function createBoundarySummaryMessage(sessionId: string, summaryText: string): Message {
  return {
    id: `compaction-boundary-${uuidv4()}`,
    sessionId,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `<conversation_continuation_summary>\n${summaryText.trim()}\n</conversation_continuation_summary>`,
      },
    ],
    timestamp: Date.now(),
  };
}

export function rebuildRuntimeMessagesFromSnapshot(
  sessionId: string,
  snapshot: SerializedCompactionBoundary,
  transcriptMessages: Message[]
): Message[] {
  let preservedTail: Message[] = [];
  try {
    const parsed = JSON.parse(snapshot.preserved_tail) as unknown;
    if (Array.isArray(parsed)) {
      preservedTail = parsed as Message[];
    }
  } catch {
    preservedTail = [];
  }

  const summaryMessage = createBoundarySummaryMessage(sessionId, snapshot.summary_text);
  summaryMessage.timestamp = snapshot.created_at;
  const newerMessages = transcriptMessages.filter((message) => message.timestamp > snapshot.created_at);
  return [summaryMessage, ...preservedTail, ...newerMessages];
}

export function buildCompactionInfo(input: {
  sessionId: string;
  compactionType: CompactionType;
  trigger: CompactionTrigger;
  boundaryCreated: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  preservedTailCount: number;
  compactedMessageCount: number;
  summaryText?: string;
}): SessionCompactionInfo {
  return {
    sessionId: input.sessionId,
    compactionType: input.compactionType,
    trigger: input.trigger,
    boundaryCreated: input.boundaryCreated,
    estimatedTokensBefore: input.estimatedTokensBefore,
    estimatedTokensAfter: input.estimatedTokensAfter,
    preservedTailCount: input.preservedTailCount,
    compactedMessageCount: input.compactedMessageCount,
    createdAt: Date.now(),
    summaryPreview: input.summaryText?.slice(0, 200),
  };
}
