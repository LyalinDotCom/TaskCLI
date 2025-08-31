import React from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { orchestrate } from '../orchestrator.js';
import { saveSession, saveCommandOutput } from '../session.js';

const h = React.createElement;

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

  const MAX_MESSAGES = 150;
  const MAX_CMD_CHARS = 4000;
  const MAX_QUEUE_ITEMS = 5;

  React.useEffect(() => {
    setMessages((m) => [
      ...m,
      { role: 'system', text: 'TaskCLI interactive mode. Type instructions and press Enter. Press Esc twice to cancel.' },
      { role: 'sep' },
    ]);
  }, []);

  // Double-Escape to cancel current run
  const [lastEscAt, setLastEscAt] = React.useState(0);
  const killRef = React.useRef(null);
  useInput((input, key) => {
    if (key.escape) {
      const now = Date.now();
      const windowMs = Number(process.env.TASKCLI_ESC_DOUBLE_MS || 600);
      if (now - lastEscAt <= windowMs) {
        setCancelRequested(true);
        setLastEscAt(0);
        setBannerText('Cancel requested. Attempting to stop…');
        setBannerColor('red');
        try { if (typeof killRef.current === 'function') killRef.current(); } catch {}
      } else {
        setLastEscAt(now);
        setBannerText('Press Esc again to cancel…');
        setBannerColor('yellow');
      }
    }
  });

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
        const vis = tasks.filter((x) => x.type !== 'session_close');
        const idx = Math.max(0, vis.findIndex((x) => x.id === task.id));
        setProgressText(`Step ${idx + 1} of ${vis.length} — ${task.title}`);
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
        const vis = tasks.filter((x) => x.type !== 'session_close');
        const idx = Math.max(0, vis.findIndex((x) => x.id === task.id));
        setProgressText(`Completed ${idx + 1}/${vis.length} — ${task.title}`);
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
    },
    onRegisterKill: (fn) => { killRef.current = fn || null; },
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
    h(Box, null, h(Text, null, `${chalk.bold('TaskCLI Interactive')} — Session ${session.id}`)),
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
      h(Text, { color: 'cyan' }, progressText),
      bannerText ? h(Text, { color: bannerColor }, bannerText) : null,
    ),
  );
}

export function startTUI({ session, models, options, initialInput }) {
  return render(h(App, { session, models, options, initialInput }), { exitOnCtrlC: true });
}
