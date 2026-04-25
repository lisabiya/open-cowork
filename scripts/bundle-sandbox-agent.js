#!/usr/bin/env node
/**
 * Bundle sandbox agent TypeScript entrypoints into flat CommonJS files.
 *
 * The Electron app loads these exact paths:
 * - dist-wsl-agent/index.js
 * - dist-lima-agent/index.js
 */

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const PROJECT_ROOT = path.join(__dirname, '..');
const AGENTS = {
  wsl: {
    entry: path.join(PROJECT_ROOT, 'src', 'main', 'sandbox', 'wsl-agent', 'index.ts'),
    outfile: path.join(PROJECT_ROOT, 'dist-wsl-agent', 'index.js'),
  },
  lima: {
    entry: path.join(PROJECT_ROOT, 'src', 'main', 'sandbox', 'lima-agent', 'index.ts'),
    outfile: path.join(PROJECT_ROOT, 'dist-lima-agent', 'index.js'),
  },
};

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`]);

async function bundleAgent(target) {
  const agent = AGENTS[target];
  if (!agent) {
    throw new Error(`Unknown sandbox agent "${target}". Expected one of: ${Object.keys(AGENTS).join(', ')}`);
  }

  const esbuild = require('esbuild');
  fs.mkdirSync(path.dirname(agent.outfile), { recursive: true });

  await esbuild.build({
    entryPoints: [agent.entry],
    outfile: agent.outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: nodeExternals,
    sourcemap: false,
    logLevel: 'info',
  });
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    throw new Error('Usage: node scripts/bundle-sandbox-agent.js <wsl|lima>');
  }
  await bundleAgent(target);
}

main().catch((error) => {
  console.error('[bundle:sandbox-agent] Failed:', error);
  process.exit(1);
});
