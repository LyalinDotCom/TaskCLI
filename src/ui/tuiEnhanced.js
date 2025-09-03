/**
 * Enhanced TUI with context management and improved status bar
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
import { getContextManager } from '../contextManager.js';
import { SlashCommandPalette, useSlashCommands } from './SlashCommandPalette.js';

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
  if (role === 'context') {
    return h(Box, null, h(Text, { color: 'yellow' }, `📁 ${text}`));
  }
  return h(Box, null, h(Text, null, text));
}


export function App({ session: initialSession, modelAdapter, initialInput, options }) {
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
  const [contextChecked, setContextChecked] = React.useState(false);
  const [workingDir] = React.useState(initialSession.meta?.cwd || process.cwd());
  const [contextManager] = React.useState(() => getContextManager(workingDir));
  
  // Use a ref for session to ensure callbacks always have the latest session data
  const sessionRef = React.useRef(initialSession);
  const session = sessionRef.current;
  
  const MAX_MESSAGES = 150;
  const HISTORY_MAX = 20;
  const killRef = React.useRef(null);
  
  // Slash command palette state
  const slashCommands = useSlashCommands(input, setInput);

  // Check for existing context and show inline message
  React.useEffect(() => {
    if (!contextChecked && !initialInput && !options.noResume) {
      setContextChecked(true);
      
      const summary = contextManager.getContextSummary();
      if (summary) {
        // Show inline context notification instead of dialog
        let contextMsg;
        if (summary.taskCount > 0 || summary.historyCount > 0) {
          contextMsg = {
            role: 'system',
            text: `💾 Previous session found (${summary.age}) with ${summary.taskCount} tasks, ${summary.historyCount} messages. Use /resume to continue or /clear to start fresh.`
          };
        } else if (summary.wasUncleanExit) {
          // Show recovery message for crashed sessions
          contextMsg = {
            role: 'system',
            text: `⚠️ Recovered from unexpected exit (${summary.age}). Use /resume to continue or /clear to start fresh.`
          };
        }
        
        if (contextMsg) {
          setMessages([contextMsg]);
        }
      }
    }
    
    // Setup clean exit handler
    const handleExit = () => {
      if (contextManager) {
        contextManager.markCleanExit();
      }
    };
    
    // Handle various exit signals
    process.on('exit', handleExit);
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
    
    return () => {
      process.removeListener('exit', handleExit);
      process.removeListener('SIGINT', handleExit);
      process.removeListener('SIGTERM', handleExit);
    };
  }, [contextManager]);

  // Load command history on mount
  React.useEffect(() => {
    try {
      const histPath = path.join(os.homedir(), '.taskcli', 'history.txt');
      if (fs.existsSync(histPath)) {
        const lines = fs.readFileSync(histPath, 'utf8').split(/\r?\n/).filter(Boolean);
        setHistory(lines.slice(0, HISTORY_MAX));
      }
    } catch {}
  }, []);

  function pushHistory(cmd) {
    setHistory((h) => {
      const updated = [cmd, ...h.filter((c) => c !== cmd)].slice(0, HISTORY_MAX);
      try {
        const dir = path.join(os.homedir(), '.taskcli');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'history.txt'), updated.join('\n'), 'utf8');
      } catch {}
      return updated;
    });
  }

  useInput((inp, key) => {
    // Handle slash command navigation first
    if (slashCommands.showPalette) {
      if (slashCommands.handleKeyNavigation(key)) {
        return;
      }
    }
    
    // Handle tab completion for slash commands even when palette isn't showing
    if (key.tab && input.startsWith('/') && !busy) {
      const completion = slashCommands.handleTabComplete();
      if (completion) {
        setInput(completion);
      }
      return;
    }
    
    if (!busy) {
      if (key.upArrow && !slashCommands.showPalette) {
        setHistIdx((idx) => {
          const next = Math.min(idx + 1, history.length - 1);
          if (next >= 0 && history[next]) setInput(history[next]);
          return next;
        });
      } else if (key.downArrow && !slashCommands.showPalette) {
        setHistIdx((idx) => {
          const next = idx - 1;
          if (next < 0) {
            setInput('');
            return -1;
          } else if (history[next]) {
            setInput(history[next]);
            return next;
          }
          return idx;
        });
      }
    }
    // Double-ESC to cancel
    if (key.escape) {
      if (cancelRequested) {
        if (killRef.current) killRef.current();
        setCancelRequested(false);
      } else {
        setCancelRequested(true);
        setTimeout(() => setCancelRequested(false), 1000);
      }
    }
  });

  const appendMessage = React.useCallback((msg) => {
    setMessages((msgs) => {
      const updated = [...msgs, msg];
      return updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;
    });
  }, []);

  // Debounced save function to avoid too frequent saves
  const saveContextDebounced = React.useCallback(() => {
    // Don't save empty sessions (no history and no tasks)
    if (contextManager && session && (session.history.length > 0 || session.tasks.length > 0)) {
      try {
        contextManager.saveContext(session);
      } catch (error) {
        console.error('Failed to save context:', error);
      }
    }
  }, [contextManager, session]);

  const ui = React.useMemo(() => ({
    appendMessage,
    onLog: (message) => {
      // Parse the message and convert to appropriate role
      if (message.includes('→')) {
        appendMessage({ role: 'tool', text: message.replace('→ ', '') });
      } else if (message.includes('✓')) {
        appendMessage({ role: 'success', text: message.replace(/^\s*✓\s*/, '') });
      } else if (message.includes('✗')) {
        appendMessage({ role: 'error', text: message.replace(/^\s*✗\s*/, '') });
      } else if (message.includes('✨')) {
        appendMessage({ role: 'complete', text: message.replace('✨ ', '') });
      } else {
        appendMessage({ role: 'output', text: message });
      }
    },
    onModelStart: (name) => {
      setModelBusy(true);
      setModelName(name || 'Gemini Pro');
      // Don't append thinking message - status bar shows this already
    },
    onModelEnd: () => {
      setModelBusy(false);
      setModelName('');
    },
    onModelBusy: (name, busy) => {
      setModelBusy(busy);
      setModelName(name || '');
    },
    onToolComplete: (toolInfo) => {
      // Add tool execution to session history
      session.history.push({
        time: toolInfo.timestamp,
        type: 'tool_execution',
        tool: toolInfo.tool,
        params: toolInfo.params,
        success: toolInfo.result?.success
      });
      // Save context after each tool completes
      saveContextDebounced();
    },
    onAIResponse: (responseInfo) => {
      // Add AI response to session history
      session.history.push({
        time: responseInfo.timestamp,
        type: 'ai_response',
        thinking: responseInfo.thinking,
        action: responseInfo.action,
        iteration: responseInfo.iteration
      });
      // Save context after each AI decision
      saveContextDebounced();
    },
    cancelRequested: () => cancelRequested,
    onRegisterKill: (fn) => {
      killRef.current = fn;
    }
  }), [cancelRequested, appendMessage, session, saveContextDebounced]);

  async function runAgent(goal) {
    setBusy(true);
    setCancelRequested(false);
    setMessages((m) => [...m, { role: 'sep' }, { role: 'user', text: goal }, { role: 'spacer' }]);
    
    // Add goal to session history
    session.history.push({
      time: new Date().toISOString(),
      type: 'user_goal',
      message: goal
    });
    
    // Save context after each interaction
    const saveContext = () => {
      if (contextManager) {
        contextManager.saveContext(session);
      }
    };
    
    // Save immediately after adding the goal
    saveContext();
    
    try {
      const agent = new AutonomousAgent(modelAdapter, {
        cwd: workingDir,
        session,
        autoConfirm: options.autoConfirm
      });

      const result = await agent.execute(goal, ui);
      
      // Don't show duplicate messages - the agent already logs completion via ui.onLog
      if (!result.success) {
        if (result.needsHelp) {
          appendMessage({ role: 'sep' });
          appendMessage({ role: 'system', text: `Need help: ${result.message}` });
        } else {
          appendMessage({ role: 'sep' });
          appendMessage({ role: 'error', text: `Failed: ${result.error || 'Unknown error'}` });
        }
      }
      
      saveSession(session);
      saveContext();
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

  // Handle context prompt choices
  const handleResume = React.useCallback(() => {
    const data = contextManager.loadContext();
    if (data) {
      // Merge the loaded session with current session
      sessionRef.current.history = [...(data.session.history || [])];
      sessionRef.current.tasks = [...(data.session.tasks || [])];
      sessionRef.current.id = data.session.id; // Keep the original session ID
      sessionRef.current.createdAt = data.session.createdAt; // Keep original creation time
      
      setMessages([
        { role: 'context', text: 'Context resumed from previous session' },
        { role: 'system', text: `Loaded ${sessionRef.current.history.length} history items and ${sessionRef.current.tasks.length} tasks` },
        { role: 'spacer' }
      ]);
    }
  }, [contextManager]);

  // Handle slash commands
  const handleSlashCommand = React.useCallback((cmd) => {
    const command = cmd.toLowerCase().trim();
    
    // Check for exact match first
    if (command === '/help') {
      appendMessage({ role: 'system', text: 'Available commands:' });
      appendMessage({ role: 'system', text: '/resume - Resume from saved context' });
      appendMessage({ role: 'system', text: '/save - Save current context' });
      appendMessage({ role: 'system', text: '/status - Show context status' });
      appendMessage({ role: 'system', text: '/clear - Clear all context and start fresh' });
      appendMessage({ role: 'system', text: '/init - Inspect project (read-only)' });
      appendMessage({ role: 'system', text: '/model - Show model configuration' });
      appendMessage({ role: 'system', text: '/thinking <n> - Set thinking budget' });
      appendMessage({ role: 'system', text: '/clear - Clear message history' });
      appendMessage({ role: 'system', text: '/exit - Exit TaskCLI' });
      return true;
    }
    
    if (command === '/resume') {
      if (contextManager.hasContext()) {
        handleResume();
        appendMessage({ role: 'context', text: 'Context resumed' });
      } else {
        appendMessage({ role: 'system', text: 'No context found to resume' });
      }
      return true;
    }
    
    
    if (command === '/save') {
      contextManager.saveContext(session);
      appendMessage({ role: 'context', text: 'Context saved to .taskcli folder' });
      return true;
    }
    
    if (command === '/status') {
      const summary = contextManager.getContextSummary();
      if (summary) {
        appendMessage({ role: 'context', text: `Context: ${summary.age} old, ${summary.taskCount} tasks, ${summary.historyCount} history items` });
      } else {
        appendMessage({ role: 'system', text: 'No context saved yet' });
      }
      return true;
    }
    
    if (command === '/clear') {
      // Archive old context and start fresh
      contextManager.archiveContext();
      setMessages([]);
      sessionRef.current.history = [];
      sessionRef.current.tasks = [];
      appendMessage({ role: 'context', text: 'Context cleared and archived. Starting fresh session.' });
      appendMessage({ role: 'spacer' });
      return true;
    }
    
    if (command === '/init') {
      appendMessage({ role: 'context', text: 'Initializing project understanding...' });
      // Create a special read-only inspection goal
      const initGoal = `IMPORTANT: This is a READ-ONLY inspection. DO NOT modify any files.

Please inspect and understand this project:
1. List the main directories and files
2. Read key configuration files (package.json, README, etc.)
3. Identify the project type and main technologies used
4. Understand the project structure and architecture
5. Summarize what this project does

Remember: Only READ files, do not write or modify anything.`;
      
      // Queue this as a task
      if (busy) {
        setQueue((q) => [...q, initGoal]);
      } else {
        runAgent(initGoal);
      }
      return true;
    }
    
    if (command === '/model') {
      appendMessage({ role: 'system', text: `Model: Gemini 2.5 Pro` });
      appendMessage({ role: 'system', text: `Thinking budget: ${modelAdapter.thinkingBudget === -1 ? 'Dynamic' : modelAdapter.thinkingBudget}` });
      return true;
    }
    
    if (command.startsWith('/thinking')) {
      const parts = command.split(' ');
      if (parts.length > 1) {
        const budget = parseInt(parts[1]);
        if (!isNaN(budget)) {
          modelAdapter.thinkingBudget = budget;
          appendMessage({ role: 'system', text: `Thinking budget set to: ${budget === -1 ? 'Dynamic' : budget}` });
          return true;
        }
      }
      appendMessage({ role: 'error', text: 'Usage: /thinking <number> (use -1 for dynamic)' });
      return true;
    }
    
    if (command === '/exit') {
      exit();
      return true;
    }
    
    // Check if this looks like a partial slash command
    if (command.startsWith('/')) {
      // Get available commands from SlashCommandPalette
      const availableCommands = ['/help', '/resume', '/save', '/clear', '/status', '/init', '/model', '/thinking', '/exit'];
      
      // Check if any command starts with this input
      const matches = availableCommands.filter(c => c.startsWith(command));
      
      if (matches.length === 1) {
        // If there's exactly one match, execute it
        return handleSlashCommand(matches[0]);
      } else if (matches.length > 1) {
        // Multiple matches - show them
        appendMessage({ role: 'error', text: `Ambiguous command. Did you mean: ${matches.join(', ')}?` });
        appendMessage({ role: 'system', text: 'Use Tab to auto-complete commands.' });
        return true;
      } else {
        // No matches - unknown command
        appendMessage({ role: 'error', text: `Unknown command: ${command}` });
        appendMessage({ role: 'system', text: 'Type /help for available commands.' });
        return true;
      }
    }
    
    return false;
  }, [contextManager, session, handleResume, appendMessage, exit]);

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
      h(Box, null, h(Text, { color: 'gray' }, `Session ${session.id}`)),
    ),
    // Messages area
    h(
      Box,
      { marginTop: 1, flexDirection: 'column', flexGrow: 1 },
      ...messages.map((m, idx) => h(Message, { key: String(idx), role: m.role, text: m.text })),
    ),
    // Slash command palette
    slashCommands.showPalette && !busy
      ? h(SlashCommandPalette, {
          input,
          onSelect: (cmd) => {
            setInput(cmd);
            slashCommands.setShowPalette(false);
          }
        })
      : null,
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
        placeholder: busy ? 'Working...' : 'Describe your goal or type / for commands...',
        onSubmit: (val) => {
          const trimmed = val.trim();
          if (!trimmed) return;
          
          // Check for slash commands
          if (trimmed.startsWith('/')) {
            if (handleSlashCommand(trimmed)) {
              setInput('');
              return;
            }
          }
          
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
    // Enhanced status bar with working directory
    h(
      Box,
      { marginTop: 1, flexDirection: 'column' },
      h(Box, { justifyContent: 'space-between' },
        h(Text, { color: 'cyan' }, busy ? 'Working...' : 'Ready'),
        modelBusy
          ? h(Text, { color: 'gray' }, h(Spinner), ` ${modelName}`)
          : h(Text, { color: 'gray' }, 'Ctrl-C: exit | ↑↓: history | /: commands')
      ),
      h(Box, null,
        h(Text, { color: 'blue', bold: true }, '📁 '),
        h(Text, { color: 'white', dimColor: true }, workingDir),
        contextManager.hasContext() 
          ? h(Text, { color: 'green' }, ' [✓ context]')
          : null
      )
    ),
  );
}

export function startTUI({ session, modelAdapter, options, initialInput }) {
  return render(
    h(App, { session, modelAdapter, options, initialInput }),
    { exitOnCtrlC: true }
  );
}