import { describe, expect, it } from 'vitest';
import { resolveMessageEndPayload, toUserFacingErrorText } from '../main/claude/agent-runner-message-end';

describe('resolveMessageEndPayload', () => {
  it('uses streamed thinking as a fallback when message_end content is empty', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: '',
      streamedThinking: 'Analyzing repository state',
    });

    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([
      {
        type: 'thinking',
        thinking: 'Analyzing repository state',
      },
    ]);
  });

  it('still surfaces an error for a truly empty successful result', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: '',
      streamedThinking: '',
    });

    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe(toUserFacingErrorText('empty_success_result'));
  });
});
