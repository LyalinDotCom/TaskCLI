import React from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { orchestrate } from '../orchestrator.js';
import { saveSession, saveCommandOutput } from '../session.js';

const h = React.createElement;

function gradientText(text) {
  const colors = ['#8be9fd', '#bd93f9', '#ff79c6', '#ffb86c'];
  const chars = [...text];
  return h(
    Text,
    null,
    ...chars.map((ch, i) => h(Text, { key: i, color: colors[i % colors.length], bold: true }, ch)),
  );
}

function headerBanner(version) {
  const title = 'TASKCLI';
  const line = ' '.repeat(1) + '>'.repeat(1) + ' ' + title + ' ';
  return h(
    Box,
    { flexDirection: 'column' },
    h(Box, null, gradientText(line)),
    h(Box, { marginTop: 1 }, h(Text, { color: 'gray' }, 'Tips: 1) Be specific  2) Ask to edit/run  3) Press Esc Esc to cancel')),
  );
}

function tildePath(p) {
  const home = os.homedir();
  return p.startsWith(home) ? p.replace(home, '~') : p;
}

function Message({ role, text }) {
  // Minimal, distinct styles per role
  if (role === 'sep') {
    const width = Math.max(40, Math.min(120, (process.stdout.columns || 80)));
    const line = '─'.repeat(width);
    return h(Box, null, h(Text, { color: 'gray', dimColor: true }, line));
  }
  if (role === 'spacer') {
    return h(Box, null, h(Text, null, ' '));
  }
  if (role === 'command') {
    return h(Box, { marginBottom: 0 }, h(Text, { color: 'cyan' }, `[CMD] $ ${text}`));
  }
  if (role === 'output') {
    return h(Box, null, h(Text, { color: 'gray' }, `│ ${text.replace(/\n$/,'')}`));
  }
  if (role === 'tasks') {
    return h(Box, { flexDirection: 'column' }, h(Text, { bold: true }, `[TASKS]`), h(Text, null, text));
  }
  if (role === 'result') {
    return h(
      Box,
      { flexDirection: 'column' },
      h(Text, { color: 'magentaBright', bold: true }, `RESULT`),
      h(Text, { color: 'magenta' }, text),
    );
  }
  if (role === 'agent') {
    return h(Box, null, h(Text, { color: 'white' }, `AGENT: ${text}`));
  }
  if (role === 'system') {
    return h(Box, null, h(Text, { color: 'white', dimColor: true }, `SYSTEM: ${text}`));
  }
  if (role === 'user') {
    return h(Box, null, h(Text, { color: 'white' }, `USER: ${text}`));
  }
  return h(Box, null, h(Text, null, text));
}

export function App({ session, models, initialInput, options }) {
  const { exit } = useApp();
  const [input, setInput] = React.useState(initialInput || '');
  const [busy, setBusy] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [tasks, setTasks] = React.useState([]);
  const [taskStatus, setTaskStatus] = React.useState({});
  const [cmdBuffer, setCmdBuffer] = React.useState('');
  const [lastCommand, setLastCommand] = React.useState('');
  const [queue, setQueue] = React.useState([]);
  const [cancelRequested, setCancelRequested] = React.useState(false);
  const [progressText, setProgressText] = React.useState('Idle');
  const [bannerText, setBannerText] = React.useState('');
  const [bannerColor, setBannerColor] = React.useState('yellow');
  const [canceling, setCanceling] = React.useState(false);
  const HISTORY_MAX = Number(process.env.TASKCLI_HISTORY_SIZE || 20);
  const [history, setHistory] = React.useState([]);
  const [histIdx, setHistIdx] = React.useState(-1); // -1 means current (blank)

  const MAX_MESSAGES = 150;
  const MAX_CMD_CHARS = 4000;
  const MAX_QUEUE_ITEMS = 5;

  React.useEffect(() => {
    // Load persistent history on mount
    try {
      const hp = historyPath();
      if (fs.existsSync(hp)) {
        const lines = fs.readFileSync(hp, 'utf8').split(/\r?\n/).filter(Boolean);
        // newest first in file
        setHistory(lines.slice(0, HISTORY_MAX));
      }
    } catch {}
    // No default system message; header + tips provide context
  }, []);

  function baseDir() {
    // Mirror session.js: prefer ~/.taskcli, else fall back to repo TaskCLI/.taskcli
    const primary = path.join(os.homedir(), '.taskcli');
    try { fs.mkdirSync(primary, { recursive: true }); return primary; } catch {}
    const alt = path.join(process.cwd(), 'TaskCLI', '.taskcli');
    try { fs.mkdirSync(alt, { recursive: true }); return alt; } catch {}
    return primary;
  }
  function historyPath() { return path.join(baseDir(), 'history.txt'); }
  function saveHistory(list) {
    try { fs.writeFileSync(historyPath(), list.slice(0, HISTORY_MAX).join('\n'), 'utf8'); } catch {}
  }
  function pushHistory(entry) {
    const e = String(entry || '').trim();
    if (!e) return;
    setHistory((prev) => {
      const withoutDup = prev.filter((x) => x !== e);
      const next = [e, ...withoutDup].slice(0, HISTORY_MAX);
      try { saveHistory(next); } catch {}
      return next;
    });
  }

  // Double-Escape to cancel current run
  const [lastEscAt, setLastEscAt] = React.useState(0);
  const killRef = React.useRef(null);
  useInput((input, key) => {
    if (key.escape) {
      if (!busy) {
        // Clear input when idle
        if (inputStateRef.current && inputStateRef.current.length > 0) {
          setInput('');
          setBannerText('Input cleared');
          setBannerColor('gray');
          return;
        }
        // If already empty, do nothing
        return;
      }
      const now = Date.now();
      const windowMs = Number(process.env.TASKCLI_ESC_DOUBLE_MS || 600);
      if (now - lastEscAt <= windowMs) {
        setCancelRequested(true);
        setLastEscAt(0);
        setBannerText('Cancel requested. Attempting to stop…');
        setBannerColor('red');
        setCanceling(true);
        try { if (typeof killRef.current === 'function') killRef.current(); } catch {}
      } else {
        setLastEscAt(now);
        setBannerText('Press Esc again to cancel…');
        setBannerColor('yellow');
      }
      return;
    }
    if (key.upArrow) {
      // Navigate history: most recent is index 0
      const maxIdx = history.length - 1;
      if (maxIdx < 0) return;
      const next = histIdx < maxIdx ? histIdx + 1 : maxIdx;
      setHistIdx(next);
      setInput(history[next] || '');
      return;
    }
    if (key.downArrow) {
      if (histIdx <= 0) {
        setHistIdx(-1);
        setInput('');
      } else {
        const next = histIdx - 1;
        setHistIdx(next);
        setInput(history[next] || '');
      }
      return;
    }
  });

  // Keep a ref to current input for escape clear logic
  const inputStateRef = React.useRef(input);
  React.useEffect(() => { inputStateRef.current = input; }, [input]);

  function appendMessage(msg) {
    setMessages((m) => {
      const next = [...m, msg];
      return next.slice(-MAX_MESSAGES);
    });
  }

  function renderTasksSnapshot(t, status) {
    const lines = t
      .filter((task) => task.type !== 'session_close')
      .map((task) => {
        const st = status[task.id] || 'pending';
        const mark = st === 'done' ? 'x' : st === 'running' ? '>' : ' ';
        const title = st === 'done' ? chalk.strikethrough(task.title) : task.title;
        return `[${mark}] ${task.id} ${title} [${task.type}]`;
      });
    return lines.join('\n');
  }

  const ui = React.useMemo(() => ({
    onPlan: (t) => {
      setTasks(t);
      appendMessage({ role: 'agent', text: `Planned ${t.length} tasks.` });
      const vis = t.filter((x) => x.type !== 'session_close');
      setProgressText(vis.length > 0 ? `Ready — 0 of ${vis.length}` : 'Ready');
      const snap = renderTasksSnapshot(t, {});
      if (snap.trim().length > 0) {
        appendMessage({ role: 'spacer' });
        appendMessage({ role: 'tasks', text: snap });
        appendMessage({ role: 'sep' });
      }
    },
    onTaskStart: (task) => {
      setTaskStatus((s) => {
        const ns = { ...s, [task.id]: 'running' };
        const snap = renderTasksSnapshot(tasks, ns);
        if (snap.trim().length > 0) {
          appendMessage({ role: 'tasks', text: snap });
          appendMessage({ role: 'spacer' });
        }
        // Progress bar text
        if (task.type === 'session_close') {
          setProgressText('Closeout — preparing summary');
        } else {
          const vis = tasks.filter((x) => x.type !== 'session_close');
          const idx = vis.findIndex((x) => x.id === task.id);
          const pos = idx >= 0 ? idx + 1 : Math.max(1, Object.values(ns).filter((v) => v === 'done').length + 1);
          setProgressText(vis.length > 0 ? `Step ${pos} of ${vis.length} — ${task.title}` : `Working — ${task.title}`);
        }
        setBannerText('');
        return ns;
      });
    },
    onTaskSuccess: (task, maybeData) => {
      setTaskStatus((s) => {
        const ns = { ...s, [task.id]: 'done' };
        const snap = renderTasksSnapshot(tasks, ns);
        if (snap.trim().length > 0) {
          appendMessage({ role: 'tasks', text: snap });
          appendMessage({ role: 'spacer' });
        }
        if (maybeData) {
          const preview = String(maybeData);
          appendMessage({ role: 'result', text: preview.length > 2000 ? preview.slice(0, 2000) + '\n…' : preview });
        }
        appendMessage({ role: 'sep' });
        if (task.type === 'session_close') {
          setProgressText('Closeout complete');
        } else {
          const vis = tasks.filter((x) => x.type !== 'session_close');
          const idx = vis.findIndex((x) => x.id === task.id);
          const pos = idx >= 0 ? idx + 1 : Math.max(1, Object.values(ns).filter((v) => v === 'done').length);
          setProgressText(vis.length > 0 ? `Completed ${pos}/${vis.length} — ${task.title}` : `Completed — ${task.title}`);
        }
        return ns;
      });
    },
    onTaskFailure: (task, error) => {
      setTaskStatus((s) => {
        const ns = { ...s, [task.id]: 'failed' };
        appendMessage({ role: 'tasks', text: renderTasksSnapshot(tasks, ns) });
        appendMessage({ role: 'spacer' });
        return ns;
      });
      appendMessage({ role: 'agent', text: `Task ${task.id} failed: ${error?.message || String(error)}` });
      appendMessage({ role: 'sep' });
    },
    onCommandOut: (s) => {
      setCmdBuffer((prev) => prev + s);
      appendMessage({ role: 'output', text: s });
    },
    onCommandErr: (s) => {
      setCmdBuffer((prev) => prev + s);
      appendMessage({ role: 'output', text: s });
    },
    onLog: (s) => appendMessage({ role: 'agent', text: s }),
    onCommandStart: (cmd) => {
      setLastCommand(cmd);
      setCmdBuffer('');
      appendMessage({ role: 'sep' });
      appendMessage({ role: 'command', text: cmd });
      appendMessage({ role: 'spacer' });
    },
    onCommandDone: ({ code, ok }) => {
      appendMessage({ role: 'agent', text: `Command finished with exit code ${code}${ok ? ' (ok)' : ' (failed)'}` });
      try {
        const p = saveCommandOutput(session, { command: lastCommand, output: cmdBuffer });
        appendMessage({ role: 'system', text: `Saved full command output to: ${p}` });
      } catch {}
      appendMessage({ role: 'sep' });
      setCanceling(false);
    },
    onRegisterKill: (fn) => { killRef.current = fn || null; if (!fn) setCanceling(false); },
    onComplete: (count) => appendMessage({ role: 'agent', text: `Completed ${count} tasks.` }),
    shouldCancel: () => !!cancelRequested,
    drainQueuedInputs: () => {
      const items = [...queue];
      if (items.length > 0) {
        appendMessage({ role: 'system', text: `Processing ${items.length} queued input(s)` });
      }
      setQueue([]);
      return items;
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tasks, taskStatus, lastCommand, cmdBuffer, queue, cancelRequested]);

  async function runOrchestrator(goal) {
    setBusy(true);
    setCancelRequested(false);
    setCmdBuffer('');
    setMessages((m) => [...m, { role: 'sep' }, { role: 'user', text: goal }, { role: 'spacer' }]);
    try {
      const res = await orchestrate({ userGoal: goal, models, session, options, ui });
      if (!res.ok) {
        setMessages((m) => [...m, { role: 'executor', text: `Error: ${res.error}` }]);
      }
      saveSession(session);
    } finally {
      setBusy(false);
      setCanceling(false);
      // Drain queued inputs
      setQueue((q) => {
        const copy = [...q];
        const next = copy.shift();
        if (next) {
          // Schedule next run
          setTimeout(() => runOrchestrator(next), 0);
        }
        return copy;
      });
    }
  }

  React.useEffect(() => {
    if (initialInput && initialInput.trim()) {
      runOrchestrator(initialInput.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return h(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    // Header banner + session id
    h(
      Box,
      { flexDirection: 'column' },
      headerBanner(''),
      h(Box, null, h(Text, { color: 'gray' }, `Session ${session.id}`)),
    ),
    h(
      Box,
      { marginTop: 1, flexDirection: 'column', flexGrow: 1 },
      ...messages.map((m, idx) => h(Message, { key: String(idx), role: m.role, text: m.text })),
    ),
    // Compact queue indicator above input
    queue.length > 0
      ? h(
          Box,
          { marginTop: 0 },
          h(Text, null, chalk.yellow('Queued: ')),
          h(
            Text,
            null,
            queue
              .slice(0, MAX_QUEUE_ITEMS)
              .map((q, i) => `${i + 1}. ${q.length > 40 ? q.slice(0, 37) + '…' : q}`)
              .join(' | '),
          ),
          queue.length > MAX_QUEUE_ITEMS
            ? h(Text, null, ` ${chalk.gray(`(+${queue.length - MAX_QUEUE_ITEMS} more)`)}`)
            : null,
        )
      : null,
    h(
      Box,
      { marginTop: 1 },
      h(Text, null, busy ? h(Spinner) : '>'),
      h(Text, null, ' '),
      h(TextInput, {
        value: input,
        onChange: setInput,
        placeholder: 'Describe your goal...',
        onSubmit: (val) => {
          const trimmed = val.trim();
          if (!trimmed) return;
          setInput('');
          pushHistory(trimmed);
          setHistIdx(-1);
          if (busy) {
            setQueue((q) => [...q, trimmed]);
          } else {
            runOrchestrator(trimmed);
          }
        },
      }),
    ),
    // Bottom status bar row (pinned at very bottom)
    h(
      Box,
      { justifyContent: 'space-between' },
      h(Text, { color: 'cyan' }, progressText || 'Ready'),
      canceling
        ? h(Text, { color: 'red' }, h(Spinner), ' Cancelling...')
        : (bannerText
            ? h(Text, { color: bannerColor }, bannerText)
            : h(Text, { color: 'gray' }, `${tildePath(session?.meta?.cwd || process.cwd())}  |  ${session?.meta?.proModel || ''}`)
          ),
    ),
  );
}

export function startTUI({ session, models, options, initialInput }) {
  return render(h(App, { session, models, options, initialInput }), { exitOnCtrlC: true });
}
