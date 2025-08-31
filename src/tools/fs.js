import fs from 'node:fs';
import path from 'node:path';

export function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export async function readFile(cwd, relPath) {
  const p = path.resolve(cwd, relPath);
  const content = await fs.promises.readFile(p, 'utf8');
  return { path: p, content };
}

export async function writeFile(cwd, relPath, content) {
  const p = path.resolve(cwd, relPath);
  ensureDirFor(p);
  await fs.promises.writeFile(p, content, 'utf8');
  return { path: p };
}

