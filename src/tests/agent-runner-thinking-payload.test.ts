import { describe, expect, it } from 'vitest';
import { restoreUnsignedThinkingBlocksForAnthropicPayload } from '../main/claude/agent-runner';

describe('restoreUnsignedThinkingBlocksForAnthropicPayload', () => {
  it('restores signed thinking text blocks using Anthropic payload signature field', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'signed reasoning' }],
        },
      ],
    };
    const sourceMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'signed reasoning',
            thinkingSignature: 'sig-123',
          },
        ],
      },
    ];

    expect(restoreUnsignedThinkingBlocksForAnthropicPayload(payload, sourceMessages)).toEqual({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'signed reasoning', signature: 'sig-123' }],
        },
      ],
    });
  });

  it('restores redacted thinking as Anthropic redacted_thinking payload blocks', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '[Reasoning redacted]' }],
        },
      ],
    };
    const sourceMessages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: '[Reasoning redacted]',
            thinkingSignature: 'opaque-data',
            redacted: true,
          },
        ],
      },
    ];

    expect(restoreUnsignedThinkingBlocksForAnthropicPayload(payload, sourceMessages)).toEqual({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'redacted_thinking', data: 'opaque-data' }],
        },
      ],
    });
  });

  it('restores thinking blocks even when payload assistant messages no longer align by index', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'second assistant reasoning' }],
        },
      ],
    };
    const sourceMessages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'first assistant text' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'second assistant reasoning',
            thinkingSignature: 'sig-second',
          },
        ],
      },
    ];

    expect(restoreUnsignedThinkingBlocksForAnthropicPayload(payload, sourceMessages)).toEqual({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'second assistant reasoning', signature: 'sig-second' },
          ],
        },
      ],
    });
  });
});
