import React from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { orchestrate } from '../orchestrator.js';
import { saveSession, saveCommandOutput } from '../session.js';

const h = React.createElement;

function Message({ role, text }) {
  // Minimal, distinct styles per role
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
    return h(Box, { flexDirection: 'column' }, h(Text, { bold: true }, `RESULT`), h(Text, null, text));
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

  const MAX_MESSAGES = 150;
  const MAX_CMD_CHARS = 4000;
  const MAX_QUEUE_ITEMS = 5;

  React.useEffect(() => {
    setMessages((m) => [
      ...m,
      { role: 'system', text: 'TaskCLI interactive mode. Type instructions and press Enter.' },
    ]);
  }, []);

  function appendMessage(msg) {
    setMessages((m) => {
      const next = [...m, msg];
      return next.slice(-MAX_MESSAGES);
    });
  }

  function renderTasksSnapshot(t, status) {
    const lines = t.map((task) => {
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
      appendMessage({ role: 'tasks', text: renderTasksSnapshot(t, {}) });
    },
    onTaskStart: (task) => {
      setTaskStatus((s) => {
        const ns = { ...s, [task.id]: 'running' };
        appendMessage({ role: 'tasks', text: renderTasksSnapshot(tasks, ns) });
        return ns;
      });
    },
    onTaskSuccess: (task, maybeData) => {
      setTaskStatus((s) => {
        const ns = { ...s, [task.id]: 'done' };
        appendMessage({ role: 'tasks', text: renderTasksSnapshot(tasks, ns) });
        if (maybeData) {
          const preview = String(maybeData);
          appendMessage({ role: 'result', text: preview.length > 2000 ? preview.slice(0, 2000) + '\n…' : preview });
        }
        return ns;
      });
    },
    onTaskFailure: (task, error) => {
      setTaskStatus((s) => {
        const ns = { ...s, [task.id]: 'failed' };
        appendMessage({ role: 'tasks', text: renderTasksSnapshot(tasks, ns) });
        return ns;
      });
      appendMessage({ role: 'agent', text: `Task ${task.id} failed: ${error?.message || String(error)}` });
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
      appendMessage({ role: 'command', text: cmd });
    },
    onCommandDone: ({ code, ok }) => {
      appendMessage({ role: 'agent', text: `Command finished with exit code ${code}${ok ? ' (ok)' : ' (failed)'}` });
      try {
        const p = saveCommandOutput(session, { command: lastCommand, output: cmdBuffer });
        appendMessage({ role: 'system', text: `Saved full command output to: ${p}` });
      } catch {}
    },
    onComplete: (count) => appendMessage({ role: 'agent', text: `Completed ${count} tasks.` }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tasks, taskStatus, lastCommand, cmdBuffer]);

  async function runOrchestrator(goal) {
    setBusy(true);
    setCmdBuffer('');
    setMessages((m) => [...m, { role: 'user', text: goal }]);
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
      { marginTop: 1, flexDirection: 'column' },
      ...messages.map((m, idx) => h(Message, { key: String(idx), role: m.role, text: m.text })),
    ),
    queue.length > 0
      ? h(
          Box,
          { marginTop: 1, flexDirection: 'column', borderStyle: 'round', padding: 1 },
          h(Text, null, chalk.yellow('Queued inputs (next up):')),
          h(Text, null, queue.slice(0, MAX_QUEUE_ITEMS).map((q, i) => `${i + 1}. ${q.length > 60 ? q.slice(0, 57) + '…' : q}`).join(' | ') + (queue.length > MAX_QUEUE_ITEMS ? ` (+${queue.length - MAX_QUEUE_ITEMS} more)` : '')),
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
            appendMessage({ role: 'system', text: `Queued: ${trimmed}` });
          } else {
            runOrchestrator(trimmed);
          }
        },
      }),
    ),
  );
}

export function startTUI({ session, models, options, initialInput }) {
  return render(h(App, { session, models, options, initialInput }), { exitOnCtrlC: true });
}
