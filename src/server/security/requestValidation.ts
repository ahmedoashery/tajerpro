import type express from 'express';

/**
 * Security HTTP headers & strict input validation helpers (OWASP-aligned).
 * Centralizes validation logic to avoid duplication across routes and repositories.
 */
export function securityHeadersMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
}

export function safeJsonErrorMiddleware(
  err: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (req.path.startsWith('/api')) {
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? Number((err as { status: number }).status)
        : 500;
    const message =
      status < 500 && err instanceof Error
        ? err.message
        : 'حدث خطأ غير متوقع أثناء معالجة الطلب.';
    res.status(status).json({ error: message });
    return;
  }
  next(err);
}

export function sanitizeText(value: unknown, maxLen = 240): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

export function assertPositiveFinite(value: unknown, fieldLabelAr: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${fieldLabelAr} يجب أن يكون رقماً موجباً أكبر من صفر.`);
  }
  return Number(num.toFixed(2));
}

export function assertFiniteNonNegative(value: unknown, fieldLabelAr: string): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`${fieldLabelAr} يجب أن يكون رقماً غير سالب.`);
  }
  return Number(num.toFixed(2));
}

export function assertValidPercent(value: unknown, fieldLabelAr: string): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new Error(`${fieldLabelAr} يجب أن يكون نسبة مئوية بين 0 و 100.`);
  }
  return Number(num.toFixed(2));
}

export function isValidYmdDate(value: unknown): boolean {
  if (!value || typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function roundMoney(val: number): number {
  return Number((Number.isFinite(val) ? val : 0).toFixed(2));
}
