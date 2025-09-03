/**
 * TUI v2 - Interactive UI for the new agent architecture
 * Simplified to work with tool-based agent instead of orchestrators
 */

import React from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import { AutonomousAgent } from '../agent.js';
import { saveSession } from '../session.js';

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

function headerBanner() {
  const title = 'TASKCLI v2';
  const line = ' '.repeat(1) + '>' + ' '.repeat(1) + title + ' ';
  return h(
    Box,
    { flexDirection: 'column' },
    h(Box, null, gradientText(line)),
  );
}

function Message({ role, text }) {
  if (role === 'sep') {
    const width = Math.max(40, Math.min(120, (process.stdout.columns || 80)));
    const line = '─'.repeat(width);
    return h(Box, null, h(Text, { color: 'gray', dimColor: true }, line));
  }
  if (role === 'spacer') {
    return h(Box, null, h(Text, null, ' '));
  }
  if (role === 'tool') {
    return h(Box, { marginBottom: 0 }, h(Text, { color: 'cyan' }, `→ ${text}`));
  }
  if (role === 'success') {
    return h(Box, null, h(Text, { color: 'green' }, `  ✓ ${text}`));
  }
  if (role === 'error') {
    return h(Box, null, h(Text, { color: 'red' }, `  ✗ ${text}`));
  }
  if (role === 'output') {
    return h(Box, null, h(Text, { color: 'gray' }, text));
  }
  if (role === 'agent') {
    return h(Box, null, h(Text, { color: 'white' }, text));
  }
  if (role === 'system') {
    return h(Box, null, h(Text, { color: 'white', dimColor: true }, text));
  }
  if (role === 'user') {
    return h(Box, null, h(Text, { color: 'white', bold: true }, `> ${text}`));
  }
  if (role === 'complete') {
    return h(Box, null, h(Text, { color: 'green', bold: true }, `✨ ${text}`));
  }
  return h(Box, null, h(Text, null, text));
}

export function App({ session, modelAdapter, initialInput, options }) {
  const { exit } = useApp();
  const [input, setInput] = React.useState(initialInput || '');
  const [busy, setBusy] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [queue, setQueue] = React.useState([]);
  const [cancelRequested, setCancelRequested] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const [modelName, setModelName] = React.useState('');
  const [history, setHistory] = React.useState([]);
  const [histIdx, setHistIdx] = React.useState(-1);
  
  const MAX_MESSAGES = 150;
  const HISTORY_MAX = 20;
  const killRef = React.useRef(null);

  // Load history on mount
  React.useEffect(() => {
    try {
      const histPath = path.join(os.homedir(), '.taskcli', 'history.txt');
      if (fs.existsSync(histPath)) {
        const lines = fs.readFileSync(histPath, 'utf8').split(/\r?\n/).filter(Boolean);
        setHistory(lines.slice(0, HISTORY_MAX));
      }
    } catch {}
  }, []);

  function saveHistory(list) {
    try {
      const dir = path.join(os.homedir(), '.taskcli');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'history.txt'), list.slice(0, HISTORY_MAX).join('\n'), 'utf8');
    } catch {}
  }

  function pushHistory(entry) {
    const e = String(entry || '').trim();
    if (!e) return;
    setHistory((prev) => {
      const withoutDup = prev.filter((x) => x !== e);
      const next = [e, ...withoutDup].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }

  // Handle keyboard input
  const [lastEscAt, setLastEscAt] = React.useState(0);
  useInput((input, key) => {
    if (key.escape) {
      if (!busy) {
        setInput('');
        return;
      }
      // Double-escape to cancel
      const now = Date.now();
      if (now - lastEscAt <= 600) {
        setCancelRequested(true);
        setLastEscAt(0);
        appendMessage({ role: 'system', text: 'Cancel requested...' });
        if (killRef.current) killRef.current();
      } else {
        setLastEscAt(now);
      }
      return;
    }
    if (key.upArrow && !busy) {
      const maxIdx = history.length - 1;
      if (maxIdx < 0) return;
      const next = histIdx < maxIdx ? histIdx + 1 : maxIdx;
      setHistIdx(next);
      setInput(history[next] || '');
      return;
    }
    if (key.downArrow && !busy) {
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
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  function appendMessage(msg) {
    setMessages((m) => {
      const next = [...m, msg];
      return next.slice(-MAX_MESSAGES);
    });
  }

  // Create UI callbacks for the agent
  const ui = React.useMemo(() => ({
    onLog: (text) => {
      // Parse agent output for tool calls
      if (text.startsWith('→ ')) {
        appendMessage({ role: 'tool', text: text.substring(2) });
      } else if (text.includes('✓ Success')) {
        appendMessage({ role: 'success', text: text.replace(/^\s*✓\s*/, '') });
      } else if (text.includes('✗ Failed')) {
        appendMessage({ role: 'error', text: text.replace(/^\s*✗\s*/, '') });
      } else if (text.startsWith('✨ ')) {
        appendMessage({ role: 'complete', text: text.substring(2) });
      } else if (text.trim().startsWith('│')) {
        // Command output
        appendMessage({ role: 'output', text: text });
      } else {
        appendMessage({ role: 'agent', text });
      }
    },
    onModelStart: (name) => {
      setModelBusy(true);
      setModelName(String(name || 'thinking'));
    },
    onModelEnd: () => {
      setModelBusy(false);
      setModelName('');
    },
    shouldCancel: () => cancelRequested,
    onRegisterKill: (fn) => {
      killRef.current = fn;
    }
  }), [cancelRequested]);

  async function runAgent(goal) {
    setBusy(true);
    setCancelRequested(false);
    setMessages((m) => [...m, { role: 'sep' }, { role: 'user', text: goal }, { role: 'spacer' }]);
    
    try {
      const agent = new AutonomousAgent(modelAdapter, {
        cwd: session.meta?.cwd || process.cwd(),
        session,
        autoConfirm: options.autoConfirm
      });

      const result = await agent.execute(goal, ui);
      
      if (result.success) {
        appendMessage({ role: 'sep' });
        appendMessage({ role: 'complete', text: result.message || 'Task completed successfully!' });
      } else if (result.needsHelp) {
        appendMessage({ role: 'sep' });
        appendMessage({ role: 'system', text: `Need help: ${result.message}` });
      } else {
        appendMessage({ role: 'sep' });
        appendMessage({ role: 'error', text: `Failed: ${result.error || 'Unknown error'}` });
      }
      
      saveSession(session);
    } catch (error) {
      appendMessage({ role: 'error', text: `Error: ${error.message}` });
    } finally {
      setBusy(false);
      setModelBusy(false);
      setModelName('');
      
      // Process queued inputs
      setQueue((q) => {
        const copy = [...q];
        const next = copy.shift();
        if (next) {
          setTimeout(() => runAgent(next), 0);
        }
        return copy;
      });
    }
  }

  // Run initial input if provided
  React.useEffect(() => {
    if (initialInput && initialInput.trim()) {
      runAgent(initialInput.trim());
    }
  }, []);

  return h(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    // Header
    h(
      Box,
      { flexDirection: 'column' },
      headerBanner(),
      h(Box, null, h(Text, { color: 'gray' }, `Session ${session.id} | ${session.meta?.cwd || process.cwd()}`)),
    ),
    // Messages area
    h(
      Box,
      { marginTop: 1, flexDirection: 'column', flexGrow: 1 },
      ...messages.map((m, idx) => h(Message, { key: String(idx), role: m.role, text: m.text })),
    ),
    // Queue indicator
    queue.length > 0
      ? h(
          Box,
          { marginTop: 0 },
          h(Text, { color: 'yellow' }, `Queued: ${queue.length} task(s)`),
        )
      : null,
    // Input area
    h(
      Box,
      { marginTop: 1 },
      h(Text, null, busy ? h(Spinner) : '>'),
      h(Text, null, ' '),
      h(TextInput, {
        value: input,
        onChange: setInput,
        placeholder: busy ? 'Working...' : 'Describe your goal...',
        onSubmit: (val) => {
          const trimmed = val.trim();
          if (!trimmed) return;
          
          setInput('');
          pushHistory(trimmed);
          setHistIdx(-1);
          
          if (busy) {
            setQueue((q) => [...q, trimmed]);
          } else {
            runAgent(trimmed);
          }
        },
      }),
    ),
    // Status bar
    h(
      Box,
      { marginTop: 1, justifyContent: 'space-between' },
      h(Text, { color: 'cyan' }, busy ? 'Working...' : 'Ready'),
      modelBusy
        ? h(Text, { color: 'gray' }, h(Spinner), ` ${modelName}`)
        : h(Text, { color: 'gray' }, 'Ctrl-C to exit | ↑↓ for history | Double-ESC to cancel'),
    ),
  );
}

export function startTUI({ session, modelAdapter, options, initialInput }) {
  return render(
    h(App, { session, modelAdapter, options, initialInput }),
    { exitOnCtrlC: true }
  );
}