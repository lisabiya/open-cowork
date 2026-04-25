import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react';
import type { ContentBlock, Message, ToolResultContent } from '../types';
import { splitAssistantTurnMessages } from '../utils/conversation-turns';
import { ContentBlockView } from './message/ContentBlockView';
import { MessageCard } from './MessageCard';

interface AssistantTurnGroupProps {
  messages: Message[];
  isProcessing?: boolean;
}

function getProcessItemKey(block: ContentBlock, messageId: string, index: number): string {
  if ('id' in block && typeof block.id === 'string') {
    return `${messageId}-${block.id}`;
  }

  if (block.type === 'tool_result') {
    return `${messageId}-tool-result-${(block as ToolResultContent).toolUseId}`;
  }

  return `${messageId}-${block.type}-${index}`;
}

export const AssistantTurnGroup = memo(function AssistantTurnGroup({
  messages,
  isProcessing = false,
}: AssistantTurnGroupProps) {
  const { t } = useTranslation();
  const [processExpanded, setProcessExpanded] = useState(false);
  const { processItems, finalMessages } = useMemo(
    () => splitAssistantTurnMessages(messages, { isProcessing }),
    [isProcessing, messages]
  );

  useEffect(() => {
    if (isProcessing && processItems.length > 0) {
      setProcessExpanded(true);
      return;
    }

    if (!isProcessing) {
      setProcessExpanded(false);
    }
  }, [isProcessing, processItems.length]);

  if (processItems.length === 0 && finalMessages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {processItems.length > 0 && (
        <div className="rounded-2xl border border-border-subtle bg-background/35 overflow-hidden">
          <button
            type="button"
            onClick={() => setProcessExpanded((prev) => !prev)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover/50 transition-colors"
          >
            <Workflow className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <span className="text-xs font-medium text-text-muted flex-1 min-w-0">
              {isProcessing ? t('chat.processRunning') : t('chat.processCompleted')}
            </span>
            <span className="text-[11px] text-text-muted/70 flex-shrink-0">
              {processItems.length} {t('chat.intermediateItems')}
            </span>
            {processExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            )}
          </button>

          {processExpanded && (
            <div className="border-t border-border/50 px-2.5 py-2 space-y-1.5 animate-fade-in bg-background/20">
              {processItems.map(({ block, allBlocks, message }, index) => (
                <ContentBlockView
                  key={getProcessItemKey(block, message.id, index)}
                  block={block}
                  isUser={false}
                  isStreaming={message.id.startsWith('partial-')}
                  allBlocks={allBlocks}
                  message={message}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {finalMessages.map(({ message, contentBlocks }) => (
        <MessageCard
          key={`assistant-final-${message.id}`}
          message={message}
          isStreaming={message.id.startsWith('partial-')}
          contentBlocks={contentBlocks}
        />
      ))}
    </div>
  );
});
