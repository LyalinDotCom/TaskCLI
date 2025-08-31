import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SESS_DIR = path.join(os.homedir(), '.taskcli', 'sessions');

export function ensureSessionDir() {
  fs.mkdirSync(SESS_DIR, { recursive: true });
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
  const file = path.join(SESS_DIR, `${session.id}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
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
