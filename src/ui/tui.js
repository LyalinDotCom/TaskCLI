import React from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { orchestrate } from '../orchestrator.js';
import { saveSession } from '../session.js';

const h = React.createElement;

function Message({ role, text }) {
  const color = role === 'user' ? 'cyan' : role === 'planner' ? 'yellow' : role === 'executor' ? 'green' : 'white';
  return h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color }, (role || '').toUpperCase()),
    h(Text, null, text),
  );
}

function TaskRow({ task, status }) {
  const indicator = status === 'running' ? h(Spinner) : status === 'done' ? '✔' : status === 'failed' ? '✖' : '•';
  return h(
    Box,
    null,
    h(Text, null, indicator, ' ', task.id, ' ', task.title, ' [', task.type, ']'),
  );
}

export function App({ session, models, initialInput, options }) {
  const { exit } = useApp();
  const [input, setInput] = React.useState(initialInput || '');
  const [busy, setBusy] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [tasks, setTasks] = React.useState([]);
  const [taskStatus, setTaskStatus] = React.useState({});
  const [cmdLog, setCmdLog] = React.useState('');

  React.useEffect(() => {
    setMessages((m) => [
      ...m,
      { role: 'system', text: 'TaskCLI interactive mode. Type instructions and press Enter.' },
    ]);
  }, []);

  const ui = React.useMemo(() => ({
    onPlan: (t) => {
      setTasks(t);
      setMessages((m) => [...m, { role: 'planner', text: `Planned ${t.length} tasks.` }]);
    },
    onTaskStart: (task) => {
      setTaskStatus((s) => ({ ...s, [task.id]: 'running' }));
    },
    onTaskSuccess: (task) => {
      setTaskStatus((s) => ({ ...s, [task.id]: 'done' }));
    },
    onTaskFailure: (task, error) => {
      setTaskStatus((s) => ({ ...s, [task.id]: 'failed' }));
      setMessages((m) => [...m, { role: 'executor', text: `Task ${task.id} failed: ${error?.message || String(error)}` }]);
    },
    onCommandOut: (s) => setCmdLog((prev) => prev + s),
    onCommandErr: (s) => setCmdLog((prev) => prev + s),
    onLog: (s) => setMessages((m) => [...m, { role: 'executor', text: s }]),
    onComplete: (count) => {
      setMessages((m) => [...m, { role: 'executor', text: `Completed ${count} tasks.` }]);
    },
  }), []);

  async function runOrchestrator(goal) {
    setBusy(true);
    setCmdLog('');
    setMessages((m) => [...m, { role: 'user', text: goal }]);
    try {
      await orchestrate({ userGoal: goal, models, session, options, ui });
      saveSession(session);
    } finally {
      setBusy(false);
    }
  }

  return h(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    h(Box, null, h(Text, null, `${chalk.bold('TaskCLI Interactive')} — Session ${session.id}`)),
    h(
      Box,
      { marginTop: 1, flexDirection: 'row' },
      h(
        Box,
        { flexGrow: 1, flexDirection: 'column', borderStyle: 'round', padding: 1 },
        ...messages.slice(-50).map((m, idx) => h(Message, { key: String(idx), role: m.role, text: m.text })),
      ),
      h(
        Box,
        { width: 48, marginLeft: 1, flexDirection: 'column', borderStyle: 'round', padding: 1 },
        h(Text, null, 'Tasks'),
        ...tasks.map((t) => h(TaskRow, { key: t.id, task: t, status: taskStatus[t.id] || 'pending' })),
      ),
    ),
    cmdLog
      ? h(
          Box,
          { marginTop: 1, flexDirection: 'column', borderStyle: 'round', padding: 1 },
          h(Text, null, chalk.gray('Command Output')),
          h(Text, null, cmdLog),
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
          if (val.trim()) {
            setInput('');
            runOrchestrator(val.trim());
          }
        },
      }),
    ),
  );
}

export function startTUI({ session, models, options, initialInput }) {
  return render(h(App, { session, models, options, initialInput }), { exitOnCtrlC: true });
}
