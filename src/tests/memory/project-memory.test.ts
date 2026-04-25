import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedUserDataRoot = path.join(os.tmpdir(), 'open-cowork-project-memory-tests');

vi.mock('electron', () => ({
  app: {
    getPath: () => mockedUserDataRoot,
  },
}));

import { ProjectMemoryService } from '../../main/memory/project-memory';

describe('ProjectMemoryService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.rmSync(mockedUserDataRoot, { recursive: true, force: true });
  });

  it('parses markdown frontmatter and injects relevant memory prompt sections', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-workspace-'));
    tempDirs.push(workspaceDir);

    const service = new ProjectMemoryService();
    const memoryRoot = service.ensureMemoryFiles(workspaceDir);
    const topicPath = path.join(memoryRoot, 'alice-preferences.md');
    fs.writeFileSync(
      topicPath,
      `---
name: Alice Preferences
description: Durable user writing preferences
type: user
---
Alice prefers concise progress updates and wants implementation notes to stay brief.
`,
      'utf8'
    );

    const topics = service.listTopics(workspaceDir);
    const promptMaterial = service.buildPromptMaterial(
      workspaceDir,
      'Please remember Alice preferences while drafting the response'
    );

    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      name: 'Alice Preferences',
      description: 'Durable user writing preferences',
      type: 'user',
    });
    expect(promptMaterial.ignoreMemory).toBe(false);
    expect(promptMaterial.promptSections.join('\n')).toContain('Alice Preferences');
    expect(promptMaterial.promptSections.join('\n')).toContain('concise progress updates');
  });

  it('skips memory injection when the user explicitly asks to ignore memory', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-workspace-'));
    tempDirs.push(workspaceDir);

    const service = new ProjectMemoryService();
    service.ensureMemoryFiles(workspaceDir);

    const promptMaterial = service.buildPromptMaterial(workspaceDir, '这轮请忽略记忆，只看当前仓库');

    expect(promptMaterial.ignoreMemory).toBe(true);
    expect(promptMaterial.promptSections).toEqual([]);
  });
});
