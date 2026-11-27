#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3000);
const appUrl = `http://127.0.0.1:${port}`;
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

console.log('\n==========================================================');
console.log('  TajirPro Nuxt + Prisma + MySQL — Automatic Launcher');
console.log('==========================================================\n');

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
  console.log('[1/4] Created .env from .env.example');
}

// Read .env key/values minimally so Prisma & health check see DATABASE_URL
const loadedEnv = { ...process.env };
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    let v = trimmed.slice(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!loadedEnv[k]) loadedEnv[k] = v;
  }
}

// 2. Auto-install dependencies
const nodeModulesDir = path.join(rootDir, 'node_modules');
const nuxtBin = path.join(nodeModulesDir, '.bin', isWin ? 'nuxt.cmd' : 'nuxt');
if (!fs.existsSync(nodeModulesDir) || !fs.existsSync(nuxtBin)) {
  console.log('[2/4] Installing dependencies automatically...');
  const install = spawnSync(npmCmd, ['install', '--include=dev', '--legacy-peer-deps'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWin,
  });
  if (install.status !== 0) {
    console.error('[ERROR] npm install failed.');
    process.exit(install.status ?? 1);
  }
} else {
  console.log('[2/4] Dependencies verified.');
}

function checkTcpPort(host, targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: targetPort, timeout: 1200 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// 3. Ensure MySQL (via Docker if localhost:3306 is down and Docker is available) & run Prisma sync
let dbReady = false;
try {
  const dbUrl = loadedEnv.DATABASE_URL || '';
  const match = dbUrl.match(/mysql:\/\/[^@]+@([^:/?]+)(?::(\d+))?/i);
  const dbHost = match?.[1] || '127.0.0.1';
  const dbPort = Number(match?.[2] || 3306);
  dbReady = await checkTcpPort(dbHost, dbPort);

  if (!dbReady && (dbHost === '127.0.0.1' || dbHost === 'localhost')) {
    const dockerCheck = spawnSync('docker', ['--version'], { stdio: 'ignore', shell: isWin });
    if (dockerCheck.status === 0 && fs.existsSync(path.join(rootDir, 'docker-compose.yml'))) {
      console.log('[3/4] Local MySQL not running — starting Docker MySQL 8.0 container...');
      spawnSync('docker', ['compose', 'up', '-d', 'mysql'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: isWin,
      });
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        if (await checkTcpPort(dbHost, dbPort)) {
          dbReady = true;
          break;
        }
      }
    }
  }
} catch {
  // Continue to Nuxt UI where user can configure MySQL visually if unavailable
}

console.log('[3/4] Generating Prisma client...');
spawnSync(npxCmd, ['prisma', 'generate'], {
  cwd: rootDir,
  env: loadedEnv,
  stdio: 'inherit',
  shell: isWin,
});

if (dbReady) {
  console.log('[3/4] Pushing Prisma schema & seeding initial MySQL data...');
  const pushed = spawnSync(npxCmd, ['prisma', 'db', 'push'], {
    cwd: rootDir,
    env: loadedEnv,
    stdio: 'inherit',
    shell: isWin,
  });
  if (pushed.status === 0) {
    spawnSync(npmCmd, ['run', 'db:seed'], {
      cwd: rootDir,
      env: loadedEnv,
      stdio: 'inherit',
      shell: isWin,
    });
  }
} else {
  console.log('[INFO] MySQL database is not reachable yet; Nuxt will open so you can enter MySQL credentials in the Server Config modal.');
}

// 4. Start Nuxt server and open browser
console.log(`[4/4] Starting Nuxt server on ${appUrl} ...\n`);
const child = spawn(npmCmd, ['run', 'dev'], {
  cwd: rootDir,
  env: { ...loadedEnv, PORT: String(port) },
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
    // ignore headless
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
      console.log(`\n[READY] TajirPro Nuxt is live at ${appUrl} — opening browser...\n`);
      openBrowser(appUrl);
    }
  });
  req.on('error', () => {});
  req.setTimeout(1500, () => req.destroy());
}, 900);

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
