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
import { createEvaluator } from '../subAgentEvaluator.js';
import { createTokenTracker } from '../tokenTracker.js';

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
  if (role === 'thinking') {
    return h(Box, null, h(Text, { color: '#9CA3AF' }, text));
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
  const [currentAgent, setCurrentAgent] = React.useState(null);
  const [evaluatingFeedback, setEvaluatingFeedback] = React.useState(false);
  const [subAgentEvaluator] = React.useState(() => createEvaluator(modelAdapter));
  const [tokenStatus, setTokenStatus] = React.useState(null);
  const [agentTokenTracker, setAgentTokenTracker] = React.useState(null);
  const [currentTasks, setCurrentTasks] = React.useState(null);
  const [activeTaskIndex, setActiveTaskIndex] = React.useState(0);
  const [collapsedThinking, setCollapsedThinking] = React.useState(true);
  const [thinkingMessages, setThinkingMessages] = React.useState([]);
  const [ctrlPressed, setCtrlPressed] = React.useState(false);
  
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
    
    // Toggle thinking messages with Ctrl+T
    if (key.ctrl && inp === 't') {
      // Mark that we just handled Ctrl+T to filter it from the input
      setCtrlPressed(true);
      setTimeout(() => setCtrlPressed(false), 50); // Reset after a short delay
      
      setCollapsedThinking(prev => {
        const newState = !prev;
        
        // Update all existing thinking messages
        setMessages(msgs => msgs.map(msg => {
          if (msg.role === 'thinking' && msg.fullThinking) {
            if (newState) {
              // Collapse the message
              const summary = msg.fullThinking.split('\n')[0].substring(0, 80);
              return {
                ...msg,
                text: `🧠 [${msg.iteration}] ${summary}... (Ctrl+T to expand)`
              };
            } else {
              // Expand the message
              return {
                ...msg,
                text: `🧠 [${msg.iteration}] Thinking:\n${msg.fullThinking}`
              };
            }
          }
          return msg;
        }));
        
        return newState;
      });
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
      
      // Collect thinking messages for collapsible display
      if (responseInfo.thinking) {
        setThinkingMessages(prev => [...prev, {
          iteration: responseInfo.iteration,
          thinking: responseInfo.thinking,
          timestamp: responseInfo.timestamp
        }]);
        
        // Try to extract task info from thinking for status bar
        // Look for patterns like "Task 1:", "Step 2:", "1.", "2.", or task lists with checkboxes
        const patterns = [
          /(?:task|step)\s*(\d+)[:\s]+([^.\n]+)/i,
          /^(\d+)\.\s+(.+?)(?:\n|$)/m,
          /^\[([x\s])\]\s+(.+?)(?:\n|$)/gm,
          /^[-*]\s+\[([x\s])\]\s+(.+?)(?:\n|$)/gm,
          /^(?:□|■|✓)\s+(.+?)(?:\n|$)/gm
        ];
        
        let extractedTasks = [];
        let currentTaskIndex = -1;
        
        // Try to find task lists with checkboxes
        const checkboxMatches = [...responseInfo.thinking.matchAll(/(?:^|\n)(?:[-*]\s+)?\[([x\s])\]\s+(.+?)(?:\n|$)/gm)];
        if (checkboxMatches.length > 0) {
          extractedTasks = checkboxMatches.map((match, i) => ({
            description: match[2].trim(),
            status: match[1].toLowerCase() === 'x' ? 'completed' : 'pending'
          }));
          currentTaskIndex = extractedTasks.findIndex(t => t.status === 'pending');
          if (currentTaskIndex >= 0) {
            extractedTasks[currentTaskIndex].status = 'in_progress';
          }
        } else {
          // Try numbered patterns
          const numberedMatch = responseInfo.thinking.match(/(?:task|step|^)\s*(\d+)[:\s.]+([^.\n]+)/im);
          if (numberedMatch) {
            const currentTaskNum = parseInt(numberedMatch[1]);
            const currentTaskDesc = numberedMatch[2].trim();
            
            // Look for total task count
            const totalMatch = responseInfo.thinking.match(/(\d+)\s*(?:tasks?|steps?|items?)/i);
            const totalTasks = totalMatch ? parseInt(totalMatch[1]) : currentTaskNum;
            
            for (let i = 0; i < totalTasks; i++) {
              extractedTasks.push({
                description: i === currentTaskNum - 1 ? currentTaskDesc : `Step ${i + 1}`,
                status: i < currentTaskNum - 1 ? 'completed' : (i === currentTaskNum - 1 ? 'in_progress' : 'pending')
              });
            }
            currentTaskIndex = currentTaskNum - 1;
          }
        }
        
        // Update UI with extracted tasks
        if (extractedTasks.length > 0) {
          setCurrentTasks(extractedTasks);
          setActiveTaskIndex(currentTaskIndex >= 0 ? currentTaskIndex : 0);
        }
        
        // Show collapsed thinking summary
        if (collapsedThinking) {
          const thinkingSummary = responseInfo.thinking.split('\n')[0].substring(0, 80);
          appendMessage({ 
            role: 'thinking', 
            text: `🧠 [${responseInfo.iteration}] ${thinkingSummary}... (Ctrl+T to expand)`,
            fullThinking: responseInfo.thinking,
            iteration: responseInfo.iteration
          });
        } else {
          // Show full thinking
          appendMessage({ 
            role: 'thinking', 
            text: `🧠 [${responseInfo.iteration}] Thinking:\n${responseInfo.thinking}`,
            fullThinking: responseInfo.thinking,
            iteration: responseInfo.iteration
          });
        }
      }
      
      // Save context after each AI decision
      saveContextDebounced();
    },
    cancelRequested: () => cancelRequested,
    onRegisterKill: (fn) => {
      killRef.current = fn;
    },
    onTokenUpdate: (status) => {
      setTokenStatus(status);
    },
    onTaskUpdate: (tasks, activeIndex) => {
      setCurrentTasks(tasks);
      setActiveTaskIndex(activeIndex !== undefined ? activeIndex : 0);
    }
  }), [cancelRequested, appendMessage, session, saveContextDebounced]);

  // Evaluate user feedback using sub-agent
  async function evaluateFeedback(userInput) {
    setEvaluatingFeedback(true);
    
    // Show indicator that sub-agent is evaluating
    appendMessage({ 
      role: 'system', 
      text: '🤖 Evaluating feedback...' 
    });
    
    try {
      // Get evaluation from sub-agent
      const evaluation = await subAgentEvaluator.evaluate({
        currentGoal: currentAgent?.currentGoal || 'Unknown',
        recentActions: currentAgent?.recentActions || [],
        newUserInput: userInput
      });
      
      if (evaluation.needsFeedback) {
        // Format and display feedback
        const formatted = subAgentEvaluator.formatFeedback(evaluation);
        if (formatted) {
          appendMessage({ 
            role: 'system', 
            text: formatted.display 
          });
          
          // If critical, pause the agent immediately
          if (evaluation.priority === 'CRITICAL' && currentAgent) {
            await currentAgent.pauseForFeedback(evaluation);
            appendMessage({ 
              role: 'system', 
              text: '⏸️ Agent paused to process critical feedback' 
            });
          } else if (evaluation.priority === 'IMPORTANT' && currentAgent) {
            // For important feedback, add to agent's context
            await currentAgent.pauseForFeedback(evaluation);
          }
        }
      } else {
        // No feedback needed - remove the evaluating message
        setMessages(msgs => msgs.filter(m => m.text !== '🤖 Evaluating feedback...'));
      }
    } catch (error) {
      console.error('Feedback evaluation failed:', error);
      // Don't show error to user - fail gracefully
    } finally {
      setEvaluatingFeedback(false);
    }
  }

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
      
      // Store agent reference for feedback evaluation
      setCurrentAgent(agent);
      
      // Store the agent's token tracker for status display
      setAgentTokenTracker(agent.getTokenTracker());

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
      setCurrentAgent(null); // Clear agent reference
      
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
      
      // Estimate token usage from loaded history for display
      if (data.session.history?.length > 0) {
        // Create a temporary token tracker just for estimation
        const tempTracker = createTokenTracker();
        
        // Estimate tokens from loaded conversation
        // Collect all text from different history entry types
        const conversationTexts = data.session.history.map(h => {
          const parts = [];
          if (h.message) parts.push(h.message);
          if (h.thinking) parts.push(h.thinking);
          if (h.action) parts.push(JSON.stringify(h.action));
          if (h.tool) parts.push(h.tool);
          if (h.params) parts.push(JSON.stringify(h.params));
          if (h.result) parts.push(JSON.stringify(h.result));
          return parts.join(' ');
        });
        
        const totalText = conversationTexts.join(' ');
        const estimatedTokens = Math.round(totalText.length / 4); // Rough estimate: 1 token ≈ 4 chars
        
        // Update token tracker with estimated usage
        tempTracker.updateFromResponse({
          inputTokenCount: estimatedTokens,
          outputTokenCount: 0,
          totalTokens: estimatedTokens
        });
        
        // Update UI with token status
        const status = tempTracker.getStatusBarText();
        setTokenStatus(status);
      }
      
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
      appendMessage({ role: 'system', text: '/tokens - Show detailed token usage' });
      appendMessage({ role: 'system', text: '/trim - Manually trim conversation history' });
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
      appendMessage({ role: 'system', text: '📊 Session & Context Status:' });
      
      // Show context status
      const summary = contextManager.getContextSummary();
      if (summary) {
        appendMessage({ role: 'context', text: `• Context: ${summary.age} old, ${summary.taskCount} tasks, ${summary.historyCount} history items` });
      } else {
        appendMessage({ role: 'system', text: '• No context saved yet' });
      }
      
      // Show token usage
      if (agentTokenTracker) {
        const status = agentTokenTracker.getStatus();
        const statusBar = agentTokenTracker.getStatusBarText();
        appendMessage({ role: 'system', text: `• Context Usage: ${statusBar.text}` });
        
        if (status.inputPercentage >= 50) {
          appendMessage({ role: 'yellow', text: `  ⚠️ Above 50% - compaction may trigger soon` });
        } else if (status.inputPercentage >= 85) {
          appendMessage({ role: 'error', text: `  🚨 Critical - emergency trimming imminent` });
        }
      } else if (tokenStatus) {
        // If no active agent but we have estimated status from resume
        appendMessage({ role: 'system', text: `• Context Usage (est): ${tokenStatus.text}` });
      }
      
      // Show session info
      appendMessage({ role: 'system', text: `• Session: ${sessionRef.current.id}` });
      appendMessage({ role: 'system', text: `• History: ${sessionRef.current.history.length} items` });
      appendMessage({ role: 'system', text: `• Tasks: ${sessionRef.current.tasks.length}` });
      
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
    
    if (command === '/tokens') {
      // Show detailed token usage report
      if (currentAgent) {
        const tracker = currentAgent.getTokenTracker();
        const report = tracker.getDetailedReport();
        appendMessage({ role: 'system', text: report });
      } else {
        appendMessage({ role: 'system', text: 'No active session to show token usage for.' });
      }
      return true;
    }
    
    if (command === '/trim') {
      // Automatic trimming information
      appendMessage({ role: 'system', text: '🧠 Intelligent Context Management:' });
      appendMessage({ role: 'system', text: '• At 50% capacity: Intelligent compaction preserves critical info' });
      appendMessage({ role: 'system', text: '• At 85% capacity: Emergency trimming if needed' });
      appendMessage({ role: 'system', text: '• Compaction preserves: objectives, errors, active tasks' });
      appendMessage({ role: 'system', text: '• Target reduction: 60-70% while keeping essential context' });
      return true;
    }
    
    if (command === '/exit') {
      exit();
      return true;
    }
    
    // Check if this looks like a partial slash command
    if (command.startsWith('/')) {
      // Get available commands from SlashCommandPalette
      const availableCommands = ['/help', '/resume', '/save', '/clear', '/status', '/init', '/model', '/thinking', '/tokens', '/trim', '/exit'];
      
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
        onChange: (newValue) => {
          // Filter out 't' or 'T' if Ctrl was just pressed (for Ctrl+T handling)
          if (ctrlPressed && newValue.length > input.length && 
              (newValue[newValue.length - 1] === 't' || newValue[newValue.length - 1] === 'T')) {
            return; // Ignore this change
          }
          setInput(newValue);
        },
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
            // Add to queue
            setQueue((q) => [...q, trimmed]);
            
            // Run sub-agent evaluator to check if this needs immediate attention
            if (currentAgent && !evaluatingFeedback) {
              evaluateFeedback(trimmed);
            }
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
        h(Text, { color: 'cyan' }, 
          evaluatingFeedback ? '🤖 Evaluating...' : 
          busy ? 'Working...' : 
          'Ready'
        ),
        modelBusy
          ? h(Text, { color: 'gray' }, h(Spinner), ` ${modelName}`)
          : evaluatingFeedback 
          ? h(Text, { color: 'yellow' }, h(Spinner), ' Sub-agent analyzing feedback')
          : h(Text, { color: 'gray' }, 
              `Ctrl-C: exit | ↑↓: history | /: commands | Ctrl+T: ${collapsedThinking ? 'expand' : 'collapse'} thinking`
            )
      ),
      h(Box, { justifyContent: 'space-between', width: '100%' },
        h(Box, null,
          h(Text, { color: 'blue', bold: true }, '📁 '),
          h(Text, { color: 'white', dimColor: true }, workingDir),
          contextManager.hasContext() 
            ? h(Text, { color: 'green' }, ' [✓ context]')
            : null
        ),
        h(Box, null,
          // Task progress display
          currentTasks && currentTasks.length > 0 ? h(
            Text, 
            { color: 'magenta' },
            `📋 ${activeTaskIndex + 1}/${currentTasks.length}: ${
              currentTasks[activeTaskIndex]?.description || 'Setting up...'
            } `
          ) : null,
          tokenStatus ? h(Text, { color: tokenStatus.color }, tokenStatus.text) : null
        )
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