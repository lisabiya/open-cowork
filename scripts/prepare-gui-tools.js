#!/usr/bin/env node

/**
 * Prepare/bundle helper tools for packaging and local runtime.
 *
 * Currently:
 * - macOS: bundles `cliclick` into `resources/tools/darwin-{arch}/bin/cliclick`
 * - Windows: downloads `rg.exe` (ripgrep) into `resources/tools/win32-x64/bin/rg.exe`
 *
 * This makes packaged apps work without requiring end users to install extra tools.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const RIPGREP_VERSION = '14.1.1';
const RIPGREP_WINDOWS_X64_URL =
  process.env.OPEN_COWORK_RIPGREP_URL ||
  `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`;

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function tryExecFile(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function detectBinaryArch(filePath) {
  const out = tryExecFile('/usr/bin/file', ['-b', filePath]);
  if (!out) return null;

  const hasArm64 = out.includes('arm64');
  const hasX64 = out.includes('x86_64');
  const isUniversal = out.includes('universal') || (hasArm64 && hasX64);

  if (isUniversal) return 'universal';
  if (hasArm64) return 'arm64';
  if (hasX64) return 'x64';
  return null;
}

function copyExecutable(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`✓ Bundled: ${src} -> ${dest}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);

    const request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirect = response.headers.location;
        file.close(() => {
          fs.rmSync(dest, { force: true });
          if (!redirect) {
            reject(new Error(`Redirect without location for ${url}`));
            return;
          }
          download(redirect, dest).then(resolve).catch(reject);
        });
        return;
      }

      if (response.statusCode !== 200) {
        file.close(() => fs.rmSync(dest, { force: true }));
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    });

    request.on('error', (error) => {
      file.close(() => fs.rmSync(dest, { force: true }));
      reject(error);
    });
  });
}

function prepareMacCliClick() {
  const projectRoot = path.join(__dirname, '..');
  const toolsRoot = path.join(projectRoot, 'resources', 'tools');
  const outDirs = {
    arm64: path.join(toolsRoot, 'darwin-arm64', 'bin'),
    x64: path.join(toolsRoot, 'darwin-x64', 'bin'),
  };

  ensureDir(outDirs.arm64);
  ensureDir(outDirs.x64);

  const outputArm = path.join(outDirs.arm64, 'cliclick');
  const outputX64 = path.join(outDirs.x64, 'cliclick');

  const haveArm = exists(outputArm);
  const haveX64 = exists(outputX64);

  if (haveArm && haveX64) {
    console.log('[prepare:gui-tools] cliclick already present for both arm64 and x64.');
    return;
  }

  const candidates = new Set(['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']);
  const whichPath = tryExecFile('/usr/bin/which', ['cliclick']);
  if (whichPath) candidates.add(whichPath);

  const found = [...candidates].filter(exists);

  if (found.length === 0) {
    const msg =
      '\n[prepare:gui-tools] ERROR: `cliclick` was not found on this build machine.\n' +
      'Install it once and rebuild:\n' +
      '  brew install cliclick\n\n' +
      'Or place binaries manually:\n' +
      `  ${outputArm}\n` +
      `  ${outputX64}\n`;
    console.error(msg);
    process.exitCode = 1;
    return;
  }

  let bundledArm = haveArm;
  let bundledX64 = haveX64;

  for (const src of found) {
    const arch = detectBinaryArch(src);
    if (!arch) continue;

    if (arch === 'universal') {
      if (!bundledArm) copyExecutable(src, outputArm);
      if (!bundledX64) copyExecutable(src, outputX64);
      bundledArm = true;
      bundledX64 = true;
      break;
    }

    if (arch === 'arm64' && !bundledArm) {
      copyExecutable(src, outputArm);
      bundledArm = true;
    }

    if (arch === 'x64' && !bundledX64) {
      copyExecutable(src, outputX64);
      bundledX64 = true;
    }
  }

  const currentArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const currentOk = currentArch === 'arm64' ? bundledArm : bundledX64;

  if (!currentOk) {
    const msg =
      `\n[prepare:gui-tools] ERROR: Found cliclick, but none matched current arch (${process.arch}).\n` +
      'Please install the correct Homebrew (arm64 under /opt/homebrew, x64 under /usr/local) or provide the binary manually.\n';
    console.error(msg);
    process.exitCode = 1;
    return;
  }

  if (!bundledArm || !bundledX64) {
    console.warn(
      `[prepare:gui-tools] Warning: cliclick bundled for ${bundledArm ? 'arm64' : ''}${bundledArm && bundledX64 ? ' & ' : ''}${bundledX64 ? 'x64' : ''}. ` +
        'If you build DMGs for both arch, make sure both binaries are available.'
    );
  }
}

async function prepareWindowsRipgrep() {
  const projectRoot = path.join(__dirname, '..');
  const toolsRoot = path.join(projectRoot, 'resources', 'tools');
  const outputDir = path.join(toolsRoot, 'win32-x64', 'bin');
  const outputExe = path.join(outputDir, 'rg.exe');
  const downloadDir = path.join(toolsRoot, '.downloads');
  const archivePath = path.join(downloadDir, `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`);
  const extractDir = path.join(downloadDir, `ripgrep-${RIPGREP_VERSION}-extract`);
  const innerDir = path.join(extractDir, `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc`);
  const extractedExe = path.join(innerDir, 'rg.exe');

  ensureDir(outputDir);
  ensureDir(downloadDir);

  if (exists(outputExe)) {
    console.log('[prepare:gui-tools] ripgrep already present for win32-x64.');
    return;
  }

  console.log(`[prepare:gui-tools] Downloading ripgrep ${RIPGREP_VERSION} for Windows x64...`);
  await download(RIPGREP_WINDOWS_X64_URL, archivePath);

  try {
    fs.rmSync(extractDir, { recursive: true, force: true });
    ensureDir(extractDir);

    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`],
      { stdio: 'inherit' }
    );

    if (!exists(extractedExe)) {
      throw new Error(`Extracted ripgrep executable not found: ${extractedExe}`);
    }

    copyExecutable(extractedExe, outputExe);
  } finally {
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform === 'darwin') {
    prepareMacCliClick();
    return;
  }

  if (process.platform === 'win32') {
    await prepareWindowsRipgrep();
    return;
  }

  console.log('[prepare:gui-tools] Current platform does not require bundled helper tools.');
}

main().catch((error) => {
  console.error('[prepare:gui-tools] ERROR:', error?.stack || error);
  process.exitCode = 1;
});
