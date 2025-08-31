import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let SESSION_DIR;

function defaultDir() {
  return path.join(os.homedir(), '.taskcli', 'sessions');
}
function fallbackDir() {
  // within repo if home is not writable in sandbox
  return path.join(process.cwd(), 'TaskCLI', '.taskcli', 'sessions');
}

export function ensureSessionDir() {
  const primary = defaultDir();
  try {
    fs.mkdirSync(primary, { recursive: true });
    SESSION_DIR = primary;
  } catch {
    const alt = fallbackDir();
    fs.mkdirSync(alt, { recursive: true });
    SESSION_DIR = alt;
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
    fs.mkdirSync(alt, { recursive: true });
    const altFile = path.join(alt, `${session.id}.json`);
    fs.writeFileSync(altFile, JSON.stringify(session, null, 2), 'utf8');
  }
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
