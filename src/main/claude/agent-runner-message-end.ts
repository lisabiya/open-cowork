import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from '@mariozechner/pi-ai';
import { splitThinkTagBlocks } from './think-tag-parser';

type MessageEndContentBlock = TextContent | ThinkingContent | ToolCall;

type MessageEndMessage = Pick<AssistantMessage, 'role' | 'content' | 'stopReason' | 'errorMessage'>;

interface ResolveMessageEndPayloadOptions {
  message?: MessageEndMessage;
  streamedText: string;
}

interface ResolvedMessageEndPayload {
  effectiveContent: MessageEndContentBlock[];
  errorText?: string;
  nextStreamedText: string;
  shouldEmitMessage: boolean;
}

export function toUserFacingErrorText(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes('first_response_timeout')) {
    return '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。';
  }
  if (lower.includes('empty_success_result')) {
    return '模型返回了一个空的成功结果，当前模型或网关兼容性可能有问题，请重试或切换协议后再试。';
  }
  if (
    lower.includes('no executable bash environment available on windows') ||
    lower.includes('no bash shell found') ||
    (lower.includes('bash') && lower.includes('not found'))
  ) {
    return [
      '当前环境缺少可用的 Bash 执行能力。',
      '建议修复：',
      '1. 在“设置 → 日志/诊断 → 环境体检”里查看并复制修复命令',
      '2. 开启 WSL2（适合 Unix-first 项目）',
      '3. 或安装 Git for Windows 作为兼容 fallback',
      '',
      `原始错误: ${errorText}`,
    ].join('\n');
  }
  if (
    lower.includes('windowsapps\\python.exe') ||
    lower.includes('windowsapps/python.exe') ||
    lower.includes('python not found') ||
    lower.includes("'python' is not recognized") ||
    lower.includes('no python runtime detected') ||
    lower.includes('unable to create process using')
  ) {
    return [
      '当前环境的 Python 运行时不可用，或命中了 WindowsApps/py launcher 的不稳定路径。',
      '建议修复：',
      '1. 在“设置 → 日志/诊断 → 环境体检”里复制 Python 修复命令',
      '2. 优先使用项目自己的 .venv / 已知解释器路径',
      '3. 避免依赖 WindowsApps 的 python alias',
      '',
      `原始错误: ${errorText}`,
    ].join('\n');
  }
  if (
    lower.includes('wsl2 is not available') ||
    lower.includes('wsl not available') ||
    lower.includes('failed to initialize wsl sandbox') ||
    lower.includes('cannot execute commands in wsl')
  ) {
    return [
      '当前机器不可用 WSL 执行环境。',
      '建议修复：',
      '1. 在管理员 PowerShell 中执行: wsl --install',
      '2. 重启系统后重新打开 Open Cowork',
      '3. 如果只是普通 Windows 项目，可先继续使用 Native Windows 模式',
      '',
      `原始错误: ${errorText}`,
    ].join('\n');
  }
  if (
    lower.includes('git not found') ||
    lower.includes("'git' is not recognized") ||
    lower.includes('failed to install plugin: claude command not found')
  ) {
    return [
      '当前环境缺少必要的命令行工具（Git 或相关 CLI）。',
      '建议修复：',
      '1. 在“设置 → 日志/诊断 → 环境体检”查看缺失项',
      '2. 安装 Git for Windows，并重启应用',
      '',
      `原始错误: ${errorText}`,
    ].join('\n');
  }
  if (
    /\b400\b/.test(errorText) ||
    lower.includes('bad request') ||
    lower.includes('invalid request')
  ) {
    return `请求被上游拒绝（400），可能是模型/协议配置不兼容。请检查模型名称、协议设置和 API 端点。\n原始错误: ${errorText}`;
  }
  if (
    /\b(401|403)\b/.test(errorText) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return `认证失败，请检查 API Key 是否正确、是否已过期或无权访问当前模型。\n原始错误: ${errorText}`;
  }
  if (
    /\b429\b/.test(errorText) ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return `请求被限流（429），当前模型或 API 端点的调用频率已达上限，请稍后重试。\n原始错误: ${errorText}`;
  }
  if (
    /\b(5\d{2})\b/.test(errorText) ||
    lower.includes('server error') ||
    lower.includes('internal error') ||
    lower.includes('service unavailable') ||
    lower.includes('overloaded')
  ) {
    return `上游服务异常，可能是模型服务过载或临时故障，SDK 将自动重试。\n原始错误: ${errorText}`;
  }
  if (
    lower.includes('terminated') ||
    lower.includes('connection reset') ||
    lower.includes('connection closed') ||
    lower.includes('connection refused') ||
    lower.includes('connection error') ||
    lower.includes('fetch failed') ||
    lower.includes('other side closed') ||
    lower.includes('reset before headers') ||
    lower.includes('upstream connect') ||
    lower.includes('retry delay')
  ) {
    return `网络连接中断（${errorText}），可能是代理/网关不稳定，SDK 将自动重试。`;
  }
  return errorText;
}

export function resolveMessageEndPayload(
  options: ResolveMessageEndPayloadOptions
): ResolvedMessageEndPayload {
  const { message, streamedText } = options;
  const nextStreamedText = '';

  if (message?.stopReason === 'error' && message.errorMessage) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText(message.errorMessage),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  const rawContent =
    Array.isArray(message?.content) && message.content.length > 0
      ? message.content
      : streamedText
        ? [{ type: 'text' as const, text: streamedText }]
        : [];

  if (rawContent.length === 0) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText('empty_success_result'),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  // Post-process: split any <think>...</think> tags in text blocks into
  // separate thinking + text content blocks for proper UI rendering.
  const effectiveContent: MessageEndContentBlock[] = [];
  for (const block of rawContent) {
    if (block.type === 'text') {
      const splitBlocks = splitThinkTagBlocks(block.text);
      for (const splitBlock of splitBlocks) {
        if (splitBlock.type === 'thinking') {
          effectiveContent.push({
            type: 'thinking',
            thinking: splitBlock.thinking,
          } as ThinkingContent);
        } else {
          effectiveContent.push({ type: 'text', text: splitBlock.text } as TextContent);
        }
      }
    } else {
      effectiveContent.push(block);
    }
  }

  return {
    effectiveContent,
    nextStreamedText,
    shouldEmitMessage: effectiveContent.length > 0 && (message?.role === 'assistant' || !message),
  };
}
