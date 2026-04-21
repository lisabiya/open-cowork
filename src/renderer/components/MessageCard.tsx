// MessageCard — top-level chat message renderer.
// Delegates block rendering to ContentBlockView and its sub-components.
import { useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Clock, XCircle } from 'lucide-react';
import type { Message, ContentBlock } from '../types';
import { getMessageRenderableBlocks } from '../utils/conversation-turns';
import { ContentBlockView } from './message/ContentBlockView';

interface MessageCardProps {
  message: Message;
  isStreaming?: boolean;
  contentBlocks?: ContentBlock[];
}

export const MessageCard = memo(function MessageCard({
  message,
  isStreaming,
  contentBlocks: contentBlocksOverride,
}: MessageCardProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isQueued = message.localStatus === 'queued';
  const isCancelled = message.localStatus === 'cancelled';
  const messageBlocks = getMessageRenderableBlocks(message);
  const contentBlocks = contentBlocksOverride ?? messageBlocks;
  const [copied, setCopied] = useState(false);

  // Extract text content for copying
  const getTextContent = () =>
    contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');

  const handleCopy = async () => {
    const text = getTextContent();
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard unavailable
      }
    }
  };

  return (
    <div className="animate-fade-in">
      {isUser ? (
        <div className="flex items-start gap-2 justify-end group">
          <div
            className={`message-user px-4 py-3 rounded-[1.65rem] max-w-[80%] min-w-0 break-words ${
              isQueued ? 'opacity-70 border-dashed' : ''
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            {isQueued && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <Clock className="w-3 h-3" />
                <span>{t('messageCard.queued')}</span>
              </div>
            )}
            {isCancelled && (
              <div className="mb-1 flex items-center gap-1 text-[11px] text-text-muted">
                <XCircle className="w-3 h-3" />
                <span>{t('messageCard.cancelled')}</span>
              </div>
            )}
            {contentBlocks.length === 0 ? (
              <span className="text-text-muted italic">{t('messageCard.emptyMessage')}</span>
            ) : (
              contentBlocks.map((block, index) => (
                <ContentBlockView
                  key={
                    'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`
                  }
                  block={block}
                  isUser={isUser}
                  isStreaming={isStreaming}
                />
              ))
            )}
          </div>
          <button
            onClick={handleCopy}
            className="mt-1 w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
            title={t('messageCard.copyMessage')}
          >
            {copied ? (
              <Check className="w-3 h-3 text-success" />
            ) : (
              <Copy className="w-3 h-3 text-text-muted" />
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {contentBlocks.map((block, index) => (
            <ContentBlockView
              key={'id' in block ? (block as { id: string }).id : `block-${block.type}-${index}`}
              block={block}
              isUser={isUser}
              isStreaming={isStreaming}
              allBlocks={messageBlocks}
              message={message}
            />
          ))}
        </div>
      )}
    </div>
  );
});
