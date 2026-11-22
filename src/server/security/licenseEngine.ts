import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LicensePayload, LicenseStatus } from '../../shared/types.ts';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const KEYS_DIR = process.env.TAJIRPRO_KEYS_DIR
  ? path.resolve(process.env.TAJIRPRO_KEYS_DIR)
  : IS_SERVERLESS
    ? path.join(os.tmpdir(), '.tajirpro-keys')
    : path.resolve(process.cwd(), '.tajirpro-keys');
const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'issuer_ed25519.pem');
const PUBLIC_KEY_FILE = path.join(KEYS_DIR, 'verify_ed25519.pem');
const INSTALL_SALT_FILE = path.join(KEYS_DIR, 'install.salt');

function ensureKeys(): {
  privateKeyPem: string;
  publicKeyPem: string;
  installSalt: string;
} {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }

  let installSalt = process.env.LICENSE_INSTALL_SECRET || '';
  if (!installSalt) {
    if (fs.existsSync(INSTALL_SALT_FILE)) {
      installSalt = fs.readFileSync(INSTALL_SALT_FILE, 'utf8').trim();
    } else {
      installSalt = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(INSTALL_SALT_FILE, installSalt, { mode: 0o600 });
    }
  }

  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) {
    return {
      privateKeyPem: fs.readFileSync(PRIVATE_KEY_FILE, 'utf8'),
      publicKeyPem: fs.readFileSync(PUBLIC_KEY_FILE, 'utf8'),
      installSalt,
    };
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  fs.writeFileSync(PRIVATE_KEY_FILE, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_FILE, publicKey, { mode: 0o644 });

  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    installSalt,
  };
}

/**
 * Generates a deterministic hardware/environment fingerprint bound to this server instance.
 * Copying the database file to another machine invalidates machine-bound licenses.
 */
export function getMachineFingerprint(): string {
  const { installSalt } = ensureKeys();
  const netIfs = os.networkInterfaces();
  const macs: string[] = [];
  for (const list of Object.values(netIfs)) {
    if (!list) continue;
    for (const iface of list) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        macs.push(iface.mac);
      }
    }
  }
  macs.sort();

  const rawIdentity = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'cpu',
    macs[0] || 'local-node',
    installSalt,
  ].join('|');

  const digest = crypto.createHash('sha256').update(rawIdentity).digest('hex');
  return `TP-HW-${digest.slice(0, 6).toUpperCase()}-${digest.slice(6, 12).toUpperCase()}-${digest.slice(12, 18).toUpperCase()}`;
}

export function issueSignedLicenseKey(params: {
  storeName: string;
  tier: 'trial' | 'pro' | 'enterprise';
  durationDays: number;
  maxTerminals: number;
  machineFingerprint?: string;
}): string {
  const { privateKeyPem } = ensureKeys();
  const now = new Date();
  const expires = new Date(now.getTime() + params.durationDays * 24 * 60 * 60 * 1000);

  const payload: LicensePayload = {
    licenseId: `LIC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    storeName: params.storeName,
    tier: params.tier,
    machineFingerprint: params.machineFingerprint || getMachineFingerprint(),
    maxTerminals: params.maxTerminals,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    features:
      params.tier === 'enterprise'
        ? ['pos', 'realtime_sync', 'epayments', 'mysql_external', 'multi_branch', 'audit_chain']
        : ['pos', 'realtime_sync', 'epayments', 'audit_chain'],
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(`TP1.${payloadB64}`, 'utf8'), privateKeyPem);
  const sigB64 = signature.toString('base64url');

  return `TP1.${payloadB64}.${sigB64}`;
}

export function verifyLicenseKey(rawKey: string | null | undefined, tamperCheckPassed = true): LicenseStatus {
  const machineFingerprint = getMachineFingerprint();

  if (!rawKey || typeof rawKey !== 'string') {
    return {
      valid: false,
      reason: 'لم يتم العثور على مفتاح ترخيص مفعل لهذا الجهاز.',
      machineFingerprint,
      payload: null,
      signatureVerified: false,
      machineBound: false,
      expired: false,
      tamperCheckPassed,
      daysRemaining: 0,
      rawKeyPreview: '',
    };
  }

  const parts = rawKey.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'TP1') {
    return {
      valid: false,
      reason: 'صيغة مفتاح الترخيص غير صالحة أو تالفة.',
      machineFingerprint,
      payload: null,
      signatureVerified: false,
      machineBound: false,
      expired: false,
      tamperCheckPassed,
      daysRemaining: 0,
      rawKeyPreview: rawKey.slice(0, 28) + '...',
    };
  }

  const [, payloadB64, sigB64] = parts;
  const { publicKeyPem } = ensureKeys();

  let signatureVerified = false;
  try {
    signatureVerified = crypto.verify(
      null,
      Buffer.from(`TP1.${payloadB64}`, 'utf8'),
      publicKeyPem,
      Buffer.from(sigB64, 'base64url')
    );
  } catch {
    signatureVerified = false;
  }

  if (!signatureVerified) {
    return {
      valid: false,
      reason: 'فشل التحقق من التوقيع الرقمي Ed25519 — تم تعديل المفتاح أو تزويره.',
      machineFingerprint,
      payload: null,
      signatureVerified: false,
      machineBound: false,
      expired: false,
      tamperCheckPassed,
      daysRemaining: 0,
      rawKeyPreview: `${rawKey.slice(0, 18)}...${rawKey.slice(-10)}`,
    };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as LicensePayload;
  } catch {
    return {
      valid: false,
      reason: 'تعذر قراءة بيانات الترخيص المشفرة.',
      machineFingerprint,
      payload: null,
      signatureVerified: false,
      machineBound: false,
      expired: false,
      tamperCheckPassed,
      daysRemaining: 0,
      rawKeyPreview: `${rawKey.slice(0, 18)}...${rawKey.slice(-10)}`,
    };
  }

  const machineBound = payload.machineFingerprint === machineFingerprint;
  const nowMs = Date.now();
  const expiresMs = new Date(payload.expiresAt).getTime();
  const expired = Number.isNaN(expiresMs) || nowMs > expiresMs;
  const daysRemaining = Math.max(0, Math.ceil((expiresMs - nowMs) / (1000 * 60 * 60 * 24)));

  let reason = 'الترخيص ساري وموثق رقمياً ومربوط ببصمة الجهاز.';
  if (!machineBound) {
    reason = 'هذا الترخيص مربوط بجهاز آخر ولا يطابق بصمة الجهاز الحالية.';
  } else if (expired) {
    reason = 'انتهت صلاحية هذا الترخيص. يرجى التجديد أو إدخال مفتاح ساري.';
  } else if (!tamperCheckPassed) {
    reason = 'تم رصد اختلاف في سلسلة التكامل (Hash Chain) للسجلات المالية.';
  }

  return {
    valid: signatureVerified && machineBound && !expired && tamperCheckPassed,
    reason,
    machineFingerprint,
    payload,
    signatureVerified,
    machineBound,
    expired,
    tamperCheckPassed,
    daysRemaining,
    rawKeyPreview: `${rawKey.slice(0, 22)}...${rawKey.slice(-12)}`,
  };
}

/**
 * Computes a deterministic SHA-256 chain hash for an invoice record so any direct DB manipulation
 * (e.g. altering grandTotal, totalProfit, or deleting/editing an invoice row) breaks the chain.
 */
export function computeInvoiceChainHash(input: {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  grandTotal: number;
  totalCostAtSale: number;
  totalProfit: number;
  status: string;
  prevHash: string;
}): string {
  const { installSalt } = ensureKeys();
  const canonical = [
    input.id,
    input.invoiceNumber,
    input.createdAt,
    input.grandTotal.toFixed(2),
    input.totalCostAtSale.toFixed(2),
    input.totalProfit.toFixed(2),
    input.status,
    input.prevHash,
  ].join('|');

  return crypto.createHmac('sha256', installSalt).update(canonical).digest('hex');
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
