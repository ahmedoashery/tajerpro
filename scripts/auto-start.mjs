#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3000);
const appUrl = `http://127.0.0.1:${port}`;
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('\n==================================================');
console.log('  TajirPro (تاجر برو) — Automatic Launcher');
console.log('==================================================\n');

const nodeMajor = Number(process.versions.node.split('.')[0] || 0);
if (nodeMajor < 20) {
  console.error(`[ERROR] Node.js v20+ is required (detected v${process.versions.node}).`);
  console.error('Please download Node.js 22 LTS from https://nodejs.org/');
  process.exit(1);
}

// 1. Ensure .env exists
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('[1/3] Created default .env configuration from .env.example');
}

// 2. Auto-install dependencies on first launch
const nodeModulesDir = path.join(rootDir, 'node_modules');
const tsxBin = path.join(nodeModulesDir, '.bin', isWin ? 'tsx.cmd' : 'tsx');
if (!fs.existsSync(nodeModulesDir) || !fs.existsSync(tsxBin)) {
  console.log('[2/3] Installing dependencies automatically (first-time setup)...');
  const install = spawnSync(npmCmd, ['install', '--include=dev', '--legacy-peer-deps'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWin,
  });
  if (install.status !== 0) {
    console.error('\n[ERROR] Dependency installation failed. Please check your internet connection and retry.');
    process.exit(install.status ?? 1);
  }
} else {
  console.log('[2/3] Dependencies verified.');
}

// 3. Start TajirPro Full-Stack Server & open browser once healthy
console.log(`[3/3] Starting TajirPro server on ${appUrl} ...\n`);
const serverEnv = { ...process.env, PORT: String(port) };
const child = spawn(npmCmd, ['run', 'dev'], {
  cwd: rootDir,
  env: serverEnv,
  stdio: 'inherit',
  shell: isWin,
});

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Non-fatal if running in headless environment
  }
}

let browserOpened = false;
const deadline = Date.now() + 90_000;
const pollTimer = setInterval(() => {
  if (browserOpened || Date.now() > deadline) {
    clearInterval(pollTimer);
    return;
  }
  const req = http.get(`${appUrl}/api/health`, (res) => {
    res.resume();
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
      browserOpened = true;
      clearInterval(pollTimer);
      console.log(`\n[READY] TajirPro is live at ${appUrl} — opening browser automatically...\n`);
      openBrowser(appUrl);
    }
  });
  req.on('error', () => {
    // Server still booting
  });
  req.setTimeout(1500, () => req.destroy());
}, 700);

const shutdown = (signal) => {
  clearInterval(pollTimer);
  if (!child.killed) child.kill(signal);
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code) => {
  clearInterval(pollTimer);
  process.exit(code ?? 0);
});
