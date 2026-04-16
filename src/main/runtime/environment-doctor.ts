import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { collectRuntimeDiagnostics, type ResolvedRuntime } from './runtime-resolver';
import { runPreflight, type PreflightIssue } from '../preflight';

export interface EnvironmentDoctorCapability {
  key: string;
  label: string;
  status: 'available' | 'warning' | 'missing';
  detail: string;
  source?: string;
  actionHint?: string;
  fixCommand?: string;
}

export interface EnvironmentDoctorReport {
  generatedAt: string;
  platform: string;
  arch: string;
  runtimes: {
    shell: ResolvedRuntime | null;
    python: ResolvedRuntime | null;
    node: ResolvedRuntime | null;
  };
  capabilities: EnvironmentDoctorCapability[];
  preflightIssues: PreflightIssue[];
}

function findExecutableInPath(executableNames: string[]): string | null {
  const pathValue = process.env.PATH || '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  for (const entry of pathValue.split(delimiter).map((part) => part.trim()).filter(Boolean)) {
    for (const executableName of executableNames) {
      const candidate = path.join(entry, executableName);
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore invalid PATH entries
      }
    }
  }
  return null;
}

function resolveBundledRgPath(): string | null {
  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    if (process.platform === 'win32') {
      candidates.push(path.join(projectRoot, 'resources', 'tools', 'win32-x64', 'bin', 'rg.exe'));
    }
    candidates.push(path.join(projectRoot, 'resources', 'tools', 'bin', 'rg'));
  } else {
    candidates.push(path.join(process.resourcesPath, 'tools', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveGitPath(): string | null {
  return findExecutableInPath(process.platform === 'win32' ? ['git.exe', 'git'] : ['git']);
}

function resolveWslPath(): string | null {
  if (process.platform !== 'win32') return null;

  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(systemRoot, 'System32', 'wsl.exe'),
    path.join(systemRoot, 'Sysnative', 'wsl.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return findExecutableInPath(['wsl.exe', 'wsl']);
}

function getCapabilityFixCommand(key: string): string | undefined {
  if (process.platform !== 'win32') return undefined;

  switch (key) {
    case 'wsl':
      return 'wsl --install';
    case 'git':
      return 'winget install --id Git.Git -e --source winget';
    case 'python':
      return 'winget install --id Python.Python.3.12 -e --source winget';
    case 'node':
      return 'winget install OpenJS.NodeJS.LTS';
    case 'shell':
      return 'winget install Microsoft.PowerShell';
    default:
      return undefined;
  }
}

function toCapability(
  key: string,
  label: string,
  pathValue: string | null,
  source?: string,
  actionHint?: string
): EnvironmentDoctorCapability {
  return pathValue
    ? {
        key,
        label,
        status: 'available',
        detail: pathValue,
        source,
      }
    : {
        key,
        label,
        status: 'missing',
        detail: 'Not detected',
        source,
        actionHint,
        fixCommand: getCapabilityFixCommand(key),
      };
}

export function collectEnvironmentDoctorReport(): EnvironmentDoctorReport {
  const runtimes = collectRuntimeDiagnostics();
  const bundledRgPath = resolveBundledRgPath();
  const gitPath = resolveGitPath();
  const wslPath = resolveWslPath();

  const capabilities: EnvironmentDoctorCapability[] = [
    runtimes.shell
      ? {
          key: 'shell',
          label: 'Windows shell runtime',
          status: runtimes.shell.warnings.length > 0 ? 'warning' : 'available',
          detail: runtimes.shell.path,
          source: runtimes.shell.source,
          actionHint: runtimes.shell.warnings[0],
          fixCommand: runtimes.shell.warnings.length > 0 ? getCapabilityFixCommand('shell') : undefined,
        }
      : {
          key: 'shell',
          label: 'Windows shell runtime',
          status: 'missing',
          detail: 'No supported shell runtime detected',
          actionHint: 'Install PowerShell 7 or use the bundled compatibility path.',
          fixCommand: getCapabilityFixCommand('shell'),
        },
    toCapability('ripgrep', 'Bundled ripgrep', bundledRgPath, bundledRgPath ? 'bundled' : undefined),
    toCapability('git', 'Git', gitPath, gitPath ? 'system' : undefined, 'Install Git for Windows.'),
    toCapability(
      'wsl',
      'WSL',
      wslPath,
      wslPath ? 'system' : undefined,
      'Install WSL2 for Unix-first projects.'
    ),
    runtimes.python
      ? {
          key: 'python',
          label: 'Python runtime',
          status: runtimes.python.warnings.length > 0 ? 'warning' : 'available',
          detail: runtimes.python.path,
          source: runtimes.python.source,
          actionHint: runtimes.python.warnings[0],
          fixCommand:
            runtimes.python.warnings.length > 0 ? getCapabilityFixCommand('python') : undefined,
        }
      : {
          key: 'python',
          label: 'Python runtime',
          status: 'missing',
          detail: 'No Python runtime detected',
          actionHint: 'Install Python or configure a workspace virtual environment.',
          fixCommand: getCapabilityFixCommand('python'),
        },
    runtimes.node
      ? {
          key: 'node',
          label: 'Node runtime',
          status: runtimes.node.warnings.length > 0 ? 'warning' : 'available',
          detail: runtimes.node.path,
          source: runtimes.node.source,
          actionHint: runtimes.node.warnings[0],
          fixCommand: runtimes.node.warnings.length > 0 ? getCapabilityFixCommand('node') : undefined,
        }
      : {
          key: 'node',
          label: 'Node runtime',
          status: 'missing',
          detail: 'No Node runtime detected',
          actionHint: 'Use the bundled Node runtime or install Node.js.',
          fixCommand: getCapabilityFixCommand('node'),
        },
  ];

  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    runtimes,
    capabilities,
    preflightIssues: runPreflight(),
  };
}
