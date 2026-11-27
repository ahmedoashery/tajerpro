import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  relativePath: string;
  data: Buffer;
  mtime?: Date;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosTime, dosDate };
}

/**
 * Builds a standard Deflate PKZIP archive purely in memory using Node's built-in zlib
 * so project exports work without relying on an external `zip` CLI binary.
 */
export function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanPath = entry.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanPath, 'utf8');
    const uncompressed = entry.data;
    const compressed = zlib.deflateRawSync(uncompressed, { level: 6 });
    const useStore = compressed.length >= uncompressed.length;
    const payload = useStore ? uncompressed : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(uncompressed);
    const { dosTime, dosDate } = toDosDateTime(entry.mtime || new Date());

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, payload);

    // Central Directory File Header (46 bytes + filename)
    const isExecutable = cleanPath.endsWith('.command') || cleanPath.endsWith('.sh');
    const unixMode = isExecutable ? 0o100755 : 0o100644;
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix (3) + 2.0
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE((unixMode << 16) >>> 0, 38); // external attrs (Unix permissions)
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.nuxt',
  '.output',
  '.vercel',
  'dist',
  'dev-dist',
  'data',
  '.tajirpro-keys',
  '.aistudio',
  'workspace',
]);

const DEFAULT_IGNORED_FILES = new Set([
  '.DS_Store',
  '.env',
  '.env.local',
  'test',
  'test-shm',
  'test-wal',
]);

export function collectDirectoryZipEntries(
  rootDir: string,
  options?: { prefixDir?: string; extraIgnoredDirs?: Set<string> }
): ZipEntryInput[] {
  const entries: ZipEntryInput[] = [];
  const ignoredDirs = options?.extraIgnoredDirs
    ? new Set([...DEFAULT_IGNORED_DIRS, ...options.extraIgnoredDirs])
    : DEFAULT_IGNORED_DIRS;

  const walk = (currentDir: string, relBase: string) => {
    const items = fs.readdirSync(currentDir, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      if (item.isDirectory()) {
        if (ignoredDirs.has(item.name)) continue;
        walk(path.join(currentDir, item.name), relBase ? `${relBase}/${item.name}` : item.name);
      } else if (item.isFile()) {
        if (DEFAULT_IGNORED_FILES.has(item.name)) continue;
        if (item.name.endsWith('.db') || item.name.endsWith('.db-wal') || item.name.endsWith('.db-shm')) {
          continue;
        }
        const fullPath = path.join(currentDir, item.name);
        const stat = fs.statSync(fullPath);
        const rel = relBase ? `${relBase}/${item.name}` : item.name;
        const zipPath = options?.prefixDir ? `${options.prefixDir}/${rel}` : rel;
        entries.push({
          relativePath: zipPath,
          data: fs.readFileSync(fullPath),
          mtime: stat.mtime,
        });
      }
    }
  };

  if (fs.existsSync(rootDir)) {
    walk(rootDir, '');
  }
  return entries;
}
