import { describe, expect, it } from 'vitest';
import type { Message } from '../../renderer/types';
import { buildTokenBudgetSnapshot } from '../../main/context/context-budget';
import {
  microCompactMessages,
  rebuildRuntimeMessagesFromSnapshot,
} from '../../main/context/context-compaction';

function textMessage(
  id: string,
  role: Message['role'],
  text: string,
  timestamp: number
): Message {
  return {
    id,
    sessionId: 'session-1',
    role,
    content: [{ type: 'text', text }],
    timestamp,
  };
}

describe('context budgeting', () => {
  it('computes warning states against the configured context budget', () => {
    const messages = [textMessage('m1', 'user', 'x'.repeat(42000), 1)];

    const snapshot = buildTokenBudgetSnapshot({
      messages,
      contextWindow: 20000,
      maxContextTokens: 18000,
      strategy: 'auto',
      systemPromptTokens: 1200,
    });

    expect(snapshot.maxContextTokens).toBe(18000);
    expect(snapshot.estimatedConversationTokens).toBeGreaterThan(8000);
    expect(snapshot.warningState).toBe('warning');
  });
});

describe('micro compaction', () => {
  it('preserves tool_use/tool_result pairings while compacting older heavy outputs', () => {
    const messages: Message[] = [
      {
        id: 'tool-use',
        sessionId: 'session-1',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'dir' } }],
        timestamp: 1,
      },
      {
        id: 'tool-result',
        sessionId: 'session-1',
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tool-1',
            content: 'A'.repeat(1200),
          },
        ],
        timestamp: 2,
      },
      textMessage('tail-1', 'user', 'keep recent', 3),
      textMessage('tail-2', 'assistant', 'still recent', 4),
    ];

    const result = microCompactMessages(messages, 2);
    const compactedBlock = result.messages[1].content[0];

    expect(result.compactedMessageCount).toBe(1);
    expect(result.messages[0].content[0]).toMatchObject({
      type: 'tool_use',
      id: 'tool-1',
    });
    expect(compactedBlock).toMatchObject({
      type: 'tool_result',
      toolUseId: 'tool-1',
    });
    expect((compactedBlock as { content: string }).content.length).toBeLessThan(400);
    expect(result.messages[2]).toEqual(messages[2]);
    expect(result.messages[3]).toEqual(messages[3]);
  });
});

describe('runtime restore', () => {
  it('rebuilds runtime context from the latest boundary plus newer transcript messages', () => {
    const preservedTail = [textMessage('tail-user', 'user', 'recent question', 10)];
    const transcript = [
      textMessage('old-user', 'user', 'stale', 5),
      ...preservedTail,
      textMessage('new-assistant', 'assistant', 'fresh reply', 20),
    ];

    const rebuilt = rebuildRuntimeMessagesFromSnapshot(
      'session-1',
      {
        summary_text: 'Earlier history summary',
        preserved_tail: JSON.stringify(preservedTail),
        created_at: 15,
      },
      transcript
    );

    expect(rebuilt).toHaveLength(3);
    expect(rebuilt[0].role).toBe('assistant');
    expect(rebuilt[0].content[0]).toMatchObject({ type: 'text' });
    expect(rebuilt[1]).toEqual(preservedTail[0]);
    expect(rebuilt[2].id).toBe('new-assistant');
    expect(rebuilt.find((message) => message.id === 'old-user')).toBeUndefined();
  });
});
