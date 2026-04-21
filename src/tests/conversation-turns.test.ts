import { describe, expect, it } from 'vitest';
import type { ContentBlock, Message } from '../renderer/types';
import {
  groupMessagesByTurn,
  splitAssistantTurnMessages,
} from '../renderer/utils/conversation-turns';

function makeMessage(
  id: string,
  role: Message['role'],
  content: ContentBlock[],
  timestamp: number
): Message {
  return {
    id,
    sessionId: 'session-1',
    role,
    content,
    timestamp,
  };
}

describe('conversation-turns', () => {
  it('groups messages by user turn', () => {
    const messages = [
      makeMessage('u1', 'user', [{ type: 'text', text: 'first' }], 1),
      makeMessage('a1', 'assistant', [{ type: 'text', text: 'one' }], 2),
      makeMessage('a2', 'assistant', [{ type: 'text', text: 'two' }], 3),
      makeMessage('u2', 'user', [{ type: 'text', text: 'second' }], 4),
      makeMessage('u3', 'user', [{ type: 'text', text: 'third' }], 5),
      makeMessage('a3', 'assistant', [{ type: 'text', text: 'three' }], 6),
    ];

    const turns = groupMessagesByTurn(messages);

    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({
      userMessage: { id: 'u1' },
      assistantMessages: [{ id: 'a1' }, { id: 'a2' }],
    });
    expect(turns[1]).toMatchObject({
      userMessage: { id: 'u2' },
      assistantMessages: [],
    });
    expect(turns[2]).toMatchObject({
      userMessage: { id: 'u3' },
      assistantMessages: [{ id: 'a3' }],
    });
  });

  it('keeps leading assistant messages as their own group', () => {
    const messages = [
      makeMessage('a0', 'assistant', [{ type: 'text', text: 'preface' }], 1),
      makeMessage('u1', 'user', [{ type: 'text', text: 'question' }], 2),
      makeMessage('a1', 'assistant', [{ type: 'text', text: 'answer' }], 3),
    ];

    const turns = groupMessagesByTurn(messages);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      userMessage: null,
      assistantMessages: [{ id: 'a0' }],
    });
    expect(turns[1]).toMatchObject({
      userMessage: { id: 'u1' },
      assistantMessages: [{ id: 'a1' }],
    });
  });

  it('folds process blocks across the whole assistant turn instead of per message', () => {
    const assistantMessages = [
      makeMessage(
        'a1',
        'assistant',
        [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'a.ts' } }],
        1
      ),
      makeMessage(
        'a2',
        'assistant',
        [{ type: 'tool_result', toolUseId: 'tool-1', content: 'file contents' }],
        2
      ),
      makeMessage(
        'a3',
        'assistant',
        [
          { type: 'thinking', thinking: 'checking details' },
          { type: 'text', text: 'done' },
        ],
        3
      ),
      makeMessage(
        'a4',
        'assistant',
        [{ type: 'tool_result', toolUseId: 'tool-2', content: 'orphan result' }],
        4
      ),
    ];

    const result = splitAssistantTurnMessages(assistantMessages);

    expect(result.processItems).toHaveLength(3);
    expect(result.processItems.map((item) => item.block.type)).toEqual([
      'tool_use',
      'thinking',
      'tool_result',
    ]);
    expect(
      result.processItems.some(
        (item) => item.block.type === 'tool_result' && item.message.id === 'a2'
      )
    ).toBe(false);
    expect(result.finalMessages).toHaveLength(1);
    expect(result.finalMessages[0]).toMatchObject({
      message: { id: 'a3' },
      contentBlocks: [{ type: 'text', text: 'done' }],
    });
  });
});
