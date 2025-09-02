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
  const last = session.history.slice(-10);
  const hints = [];
  
  // Track important context like created directories and files
  const createdDirs = new Set();
  const createdFiles = new Set();
  
  for (const e of session.history) {
    if (e.type === 'run_command' && e.summary) {
      // Track directory creation from commands
      const createNextMatch = e.summary.match(/create-next-app.*?\s+(\S+)/);
      if (createNextMatch) {
        createdDirs.add(createNextMatch[1]);
      }
      if (e.summary.includes('mkdir ')) {
        const dirMatch = e.summary.match(/mkdir\s+(\S+)/);
        if (dirMatch) createdDirs.add(dirMatch[1]);
      }
    } else if (e.type === 'write_file' || e.type === 'edit_file') {
      // Track file creations/edits
      const pathMatch = e.summary?.match(/(?:Wrote|Generated|Edited)\s+(.+)$/);
      if (pathMatch) createdFiles.add(pathMatch[1]);
    }
  }
  
  // Add context about created resources
  if (createdDirs.size > 0) {
    hints.push(`Created directories: ${Array.from(createdDirs).join(', ')}`);
  }
  if (createdFiles.size > 0 && createdFiles.size <= 5) {
    hints.push(`Created/modified files: ${Array.from(createdFiles).join(', ')}`);
  } else if (createdFiles.size > 5) {
    const samples = Array.from(createdFiles).slice(-5);
    hints.push(`Created/modified ${createdFiles.size} files including: ${samples.join(', ')}`);
  }
  
  // Add recent history
  hints.push('\nRecent actions:');
  for (const e of last) {
    if (e.type === 'user_goal') {
      hints.push(`User goal: ${e.message}`);
    } else if (e.summary) {
      hints.push(`${e.type}: ${e.summary}`);
    }
  }
  
  return hints.length > 1 ? hints.join('\n') : 'No prior history.';
}
