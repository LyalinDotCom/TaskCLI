import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let SESSION_DIR;
let BASE_DIR;

function defaultDir() {
  return path.join(os.homedir(), '.taskcli');
}
function fallbackDir() {
  // within repo if home is not writable in sandbox
  return path.join(process.cwd(), 'TaskCLI', '.taskcli');
}

export function ensureSessionDir() {
  const primary = defaultDir();
  try {
    fs.mkdirSync(path.join(primary, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(primary, 'logs'), { recursive: true });
    BASE_DIR = primary;
    SESSION_DIR = path.join(primary, 'sessions');
  } catch {
    const alt = fallbackDir();
    fs.mkdirSync(path.join(alt, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(alt, 'logs'), { recursive: true });
    BASE_DIR = alt;
    SESSION_DIR = path.join(alt, 'sessions');
  }
}

export function newSession(meta = {}) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    id,
    createdAt: new Date().toISOString(),
    meta,
    history: [],
    tasks: [],
  };
}

export function saveSession(session) {
  if (!SESSION_DIR) ensureSessionDir();
  const file = path.join(SESSION_DIR, `${session.id}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
  } catch {
    // last-resort: try fallback dir
    const alt = fallbackDir();
    fs.mkdirSync(path.join(alt, 'sessions'), { recursive: true });
    const altFile = path.join(alt, 'sessions', `${session.id}.json`);
    fs.writeFileSync(altFile, JSON.stringify(session, null, 2), 'utf8');
  }
}

export function saveCommandOutput(session, { command, output }) {
  if (!BASE_DIR) ensureSessionDir();
  const logsDir = path.join(BASE_DIR, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const safe = String(command || 'command').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
  const file = path.join(logsDir, `${session.id}_${Date.now()}_${safe}.log`);
  const header = `# Command: ${command}\n# Time: ${new Date().toISOString()}\n\n`;
  fs.writeFileSync(file, header + (output || ''), 'utf8');
  return file;
}

export function appendEvent(session, event) {
  session.history.push({ time: new Date().toISOString(), ...event });
}

export function upsertTask(session, task) {
  const idx = session.tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) session.tasks[idx] = { ...session.tasks[idx], ...task };
  else session.tasks.push(task);
}

export function summarizeMemory(session) {
  const last = session.history.slice(-6);
  const hints = last.map((e) => `${e.type}: ${e.summary || e.message || ''}`).join('\n');
  return hints || 'No prior history.';
}
