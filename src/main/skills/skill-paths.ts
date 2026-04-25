import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isPathWithinRoot } from '../../shared/path-containment';

export interface ResolveBuiltinSkillsPathOptions {
  onFound?: (skillsPath: string) => void;
  onMissing?: () => void;
}

export interface ResolveGlobalSkillsPathOptions {
  configuredPath?: string;
  validateConfiguredPath?: boolean;
  onFallback?: (fallbackPath: string, preferredPath: string) => void;
}

export interface SkillSyncOptions {
  onWarn?: (message: string, error?: unknown) => void;
}

export function physicalDirExists(dirPath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const originalFs = require('original-fs') as typeof import('fs');
    return originalFs.existsSync(dirPath) && originalFs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function resolveBuiltinSkillsPath(options: ResolveBuiltinSkillsPathOptions = {}): string {
  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');
  const possiblePaths = [
    path.join(__dirname, '..', '..', '..', '.claude', 'skills'),
    path.join(process.resourcesPath || '', 'skills'),
    ...(physicalDirExists(path.join(unpackedPath, '.claude', 'skills'))
      ? [path.join(unpackedPath, '.claude', 'skills')]
      : []),
    path.join(appPath, '.claude', 'skills'),
  ];

  for (const skillsPath of possiblePaths) {
    if (fs.existsSync(skillsPath)) {
      options.onFound?.(skillsPath);
      return skillsPath;
    }
  }

  options.onMissing?.();
  return '';
}

export function getAppClaudeDir(): string {
  return path.join(app.getPath('userData'), 'claude');
}

export function getRuntimeSkillsDir(): string {
  return path.join(getAppClaudeDir(), 'skills');
}

export function getDefaultGlobalSkillsPath(): string {
  return getRuntimeSkillsDir();
}

export function getUserClaudeSkillsDir(): string {
  return path.join(app.getPath('home'), '.claude', 'skills');
}

export function resolveGlobalSkillsPath(options: ResolveGlobalSkillsPathOptions = {}): string {
  const fallbackPath = getDefaultGlobalSkillsPath();
  const configuredPath = (options.configuredPath || '').trim();
  const preferredPath = configuredPath ? path.resolve(configuredPath) : fallbackPath;

  if (configuredPath && options.validateConfiguredPath) {
    const allowedBases = [app.getPath('userData'), app.getPath('home'), process.cwd()];
    const isWithinAllowed = allowedBases.some((base) => isPathWithinRoot(preferredPath, base));
    if (!isWithinAllowed) {
      throw new Error(`Skills path outside allowed directories: ${preferredPath}`);
    }
  }

  try {
    if (!fs.existsSync(preferredPath)) {
      fs.mkdirSync(preferredPath, { recursive: true });
    }
    if (!fs.statSync(preferredPath).isDirectory()) {
      throw new Error('Configured path is not a directory');
    }
    return preferredPath;
  } catch {
    if (preferredPath !== fallbackPath) {
      options.onFallback?.(fallbackPath, preferredPath);
    }
    if (!fs.existsSync(fallbackPath)) {
      fs.mkdirSync(fallbackPath, { recursive: true });
    }
    return fallbackPath;
  }
}

export function copyDirectorySync(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const entries = fs.readdirSync(source);
  for (const entry of entries) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const stat = fs.statSync(sourcePath);

    if (stat.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

export function syncUserSkillsToDir(targetDir: string, options: SkillSyncOptions = {}): void {
  const userSkillsDir = getUserClaudeSkillsDir();
  if (!fs.existsSync(userSkillsDir)) {
    return;
  }

  const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(userSkillsDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.lstatSync(targetPath);
        if (!stat.isSymbolicLink()) {
          continue;
        }
        fs.unlinkSync(targetPath);
      } catch {
        continue;
      }
    }

    try {
      fs.symlinkSync(sourcePath, targetPath, 'dir');
    } catch (error) {
      try {
        copyDirectorySync(sourcePath, targetPath);
      } catch (copyError) {
        options.onWarn?.(`Failed to import user skill: ${entry.name}`, copyError ?? error);
      }
    }
  }
}

export function syncConfiguredSkillsToRuntimeDir(
  runtimeSkillsDir: string,
  configuredPath: string | undefined,
  options: SkillSyncOptions = {}
): void {
  const configuredSkillsDir = resolveGlobalSkillsPath({ configuredPath });
  if (configuredSkillsDir === runtimeSkillsDir) {
    return;
  }
  if (!fs.existsSync(configuredSkillsDir) || !fs.statSync(configuredSkillsDir).isDirectory()) {
    return;
  }

  const entries = fs.readdirSync(configuredSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(configuredSkillsDir, entry.name);
    const targetPath = path.join(runtimeSkillsDir, entry.name);
    try {
      if (fs.existsSync(targetPath)) {
        const stat = fs.lstatSync(targetPath);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(targetPath);
        } else {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
      }
      fs.symlinkSync(sourcePath, targetPath, 'dir');
    } catch (error) {
      try {
        copyDirectorySync(sourcePath, targetPath);
      } catch (copyError) {
        options.onWarn?.(`Failed to sync configured skill: ${entry.name}`, copyError ?? error);
      }
    }
  }
}
