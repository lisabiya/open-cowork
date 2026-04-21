// Thinking block — expanded content is controlled by parent grouping
import { Suspense, lazy, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import { PanelErrorBoundary } from '../PanelErrorBoundary';
import type { ProcessCollapsibleProps } from './types';

const MessageMarkdown = lazy(() =>
  import('../MessageMarkdown').then((module) => ({ default: module.MessageMarkdown }))
);

interface ThinkingBlockProps extends ProcessCollapsibleProps {
  block: { type: 'thinking'; thinking: string };
}

export const ThinkingBlock = memo(function ThinkingBlock({ block }: ThinkingBlockProps) {
  const { t } = useTranslation();
  const text = block.thinking || '';
  if (!text) return null;

  return (
    <div className="rounded-2xl border border-border-subtle bg-background/40 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border/50">
        <Brain className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
        <span className="text-xs font-medium text-text-muted">{t('messageCard.thinking')}</span>
      </div>
      <div className="px-4 py-3 animate-fade-in">
        <div className="text-sm text-text-secondary leading-relaxed prose-chat max-w-none">
          <PanelErrorBoundary
            name="ThinkingMarkdown"
            fallback={<div className="whitespace-pre-wrap">{text}</div>}
          >
            <Suspense fallback={<div className="whitespace-pre-wrap">{text}</div>}>
              <MessageMarkdown normalizedText={text} />
            </Suspense>
          </PanelErrorBoundary>
        </div>
      </div>
    </div>
  );
});
