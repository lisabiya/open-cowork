import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { MountedPath } from '../../renderer/types';

export const PROJECT_MEMORY_VIRTUAL_PATH = '/mnt/project-memory';
const VALID_MEMORY_TYPES = new Set(['user', 'feedback', 'project', 'reference']);

export interface ProjectMemoryTopic {
  filePath: string;
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  body: string;
}

export interface ProjectMemoryPromptMaterial {
  mountedPath?: MountedPath;
  memoryRoot?: string;
  ignoreMemory: boolean;
  promptSections: string[];
  topics: ProjectMemoryTopic[];
}

function safeGitRoot(cwd: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function tokenizeQuery(query: string): string[] {
  const lowered = query.toLowerCase();
  const asciiTokens = lowered
    .split(/[^a-z0-9_./-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const cjkTokens = lowered.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return Array.from(new Set([...asciiTokens, ...cjkTokens, lowered.trim()].filter(Boolean)));
}

function parseFrontmatter(content: string): {
  metadata: Partial<ProjectMemoryTopic>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { metadata: {}, body: content.trim() };
  }

  const metadata: Partial<ProjectMemoryTopic> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === 'name') {
      metadata.name = value;
    } else if (key === 'description') {
      metadata.description = value;
    } else if (key === 'type' && VALID_MEMORY_TYPES.has(value)) {
      metadata.type = value as ProjectMemoryTopic['type'];
    }
  }

  return {
    metadata,
    body: content.slice(match[0].length).trim(),
  };
}

export class ProjectMemoryService {
  resolveWorkspaceRoot(cwd: string): string {
    return safeGitRoot(cwd) ?? cwd;
  }

  resolveMemoryRoot(cwd: string): string {
    const workspaceRoot = this.resolveWorkspaceRoot(cwd);
    const workspaceHash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12);
    return path.join(app.getPath('userData'), 'projects', workspaceHash, 'memory');
  }

  ensureMemoryFiles(cwd: string): string {
    const memoryRoot = this.resolveMemoryRoot(cwd);
    fs.mkdirSync(memoryRoot, { recursive: true });
    const indexPath = path.join(memoryRoot, 'MEMORY.md');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        '# Project Memory\n\nUse this directory for durable facts that cannot be inferred from the current repository state.\n',
        'utf8'
      );
    }
    return memoryRoot;
  }

  getMountedPath(cwd?: string): MountedPath | undefined {
    if (!cwd) {
      return undefined;
    }
    return {
      virtual: PROJECT_MEMORY_VIRTUAL_PATH,
      real: this.ensureMemoryFiles(cwd),
    };
  }

  shouldIgnoreMemory(userPrompt: string): boolean {
    return /不要用记忆|忽略记忆|别用记忆|不要使用记忆|ignore memory|don't use memory|without memory|no memory/i.test(
      userPrompt
    );
  }

  listTopics(cwd: string): ProjectMemoryTopic[] {
    const memoryRoot = this.ensureMemoryFiles(cwd);
    const entries = fs
      .readdirSync(memoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md');

    return entries
      .map((entry) => {
        const filePath = path.join(memoryRoot, entry.name);
        const content = fs.readFileSync(filePath, 'utf8');
        const { metadata, body } = parseFrontmatter(content);
        const name = metadata.name?.trim() || path.basename(entry.name, '.md');
        const description = metadata.description?.trim() || '';
        const type = metadata.type && VALID_MEMORY_TYPES.has(metadata.type) ? metadata.type : 'project';
        return {
          filePath,
          name,
          description,
          type,
          body,
        } satisfies ProjectMemoryTopic;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  buildPromptMaterial(cwd: string | undefined, userPrompt: string): ProjectMemoryPromptMaterial {
    if (!cwd) {
      return { ignoreMemory: false, promptSections: [], topics: [] };
    }

    const memoryRoot = this.ensureMemoryFiles(cwd);
    const mountedPath = this.getMountedPath(cwd);
    const ignoreMemory = this.shouldIgnoreMemory(userPrompt);
    const topics = this.listTopics(cwd);
    if (ignoreMemory || topics.length === 0) {
      return {
        mountedPath,
        memoryRoot,
        ignoreMemory,
        promptSections: [],
        topics,
      };
    }

    const queryTokens = tokenizeQuery(userPrompt);
    const rankedTopics = topics
      .map((topic) => {
        const haystack = `${topic.name}\n${topic.description}\n${topic.body}`.toLowerCase();
        const score = queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        return { topic, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.topic.name.localeCompare(b.topic.name))
      .slice(0, 3)
      .map((item) => item.topic);

    const indexSummary = topics
      .slice(0, 12)
      .map(
        (topic) =>
          `- ${topic.name} [${topic.type}]${topic.description ? `: ${topic.description}` : ''}`
      )
      .join('\n');

    const relevantTopicsSection =
      rankedTopics.length > 0
        ? rankedTopics
            .map(
              (topic) =>
                `### ${topic.name}\nType: ${topic.type}\n${topic.description ? `Description: ${topic.description}\n` : ''}${topic.body.slice(0, 1600).trim()}`
            )
            .join('\n\n')
        : '';

    return {
      mountedPath,
      memoryRoot,
      ignoreMemory: false,
      topics,
      promptSections: [
        `<project_memory_guidance>
Use project memory only for durable information that cannot be derived from the current repository state.
Ignore project memory when it conflicts with the user's current instruction or with the checked-out code.
Do not treat project memory as a task list, recent diff log, or temporary scratchpad.
Project memory files are mounted at ${PROJECT_MEMORY_VIRTUAL_PATH}.
</project_memory_guidance>`,
        `<project_memory_index>\n${indexSummary || '(no indexed topics)'}\n</project_memory_index>`,
        relevantTopicsSection
          ? `<project_memory_relevant>\n${relevantTopicsSection}\n</project_memory_relevant>`
          : '',
      ].filter(Boolean),
    };
  }
}
