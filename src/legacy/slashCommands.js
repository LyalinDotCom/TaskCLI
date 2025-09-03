/**
 * Slash commands system for TaskCLI
 * Allows runtime configuration and control via /command syntax
 */

const commands = {
  thinkingbudget: {
    name: 'thinkingbudget',
    description: 'Set the thinking token budget for Gemini Pro (-1 to disable)',
    usage: '/thinkingBudget <number>',
    handler: (args, session) => {
      const value = args[0];
      if (!value) {
        const current = session.config?.thinkingBudget ?? 8000;
        return {
          success: true,
          message: `Current thinking budget: ${current === -1 ? 'disabled' : current + ' tokens'}`
        };
      }
      
      const budget = parseInt(value, 10);
      if (isNaN(budget)) {
        return {
          success: false,
          message: `Invalid value: "${value}". Please provide a number (e.g., /thinkingBudget 8000 or /thinkingBudget -1)`
        };
      }
      
      if (budget !== -1 && (budget < 0 || budget > 100000)) {
        return {
          success: false,
          message: `Invalid budget: ${budget}. Use -1 to disable or a value between 0 and 100000`
        };
      }
      
      // Update session config
      if (!session.config) session.config = {};
      session.config.thinkingBudget = budget;
      
      return {
        success: true,
        message: `Thinking budget ${budget === -1 ? 'disabled' : `set to ${budget} tokens`}`
      };
    }
  },
  
  model: {
    name: 'model',
    description: 'Show current model configuration',
    usage: '/model',
    handler: (args, session) => {
      const thinkingBudget = session.config?.thinkingBudget ?? 8000;
      return {
        success: true,
        message: `Models: Planning (Gemini 2.5 Flash), Execution (Gemini 2.5 Pro with ${thinkingBudget === -1 ? 'no thinking' : thinkingBudget + ' token thinking budget'})`
      };
    }
  },
  
  clear: {
    name: 'clear',
    description: 'Clear the message history',
    usage: '/clear',
    handler: (args, session) => {
      return {
        success: true,
        message: 'Message history cleared',
        action: 'clear_messages'
      };
    }
  },
  
  session: {
    name: 'session',
    description: 'Show session information',
    usage: '/session',
    handler: (args, session) => {
      const taskCount = session.tasks?.length || 0;
      const historyCount = session.history?.length || 0;
      return {
        success: true,
        message: `Session ${session.id}\nTasks: ${taskCount}, History: ${historyCount} events, Working dir: ${session.meta?.cwd || 'unknown'}`
      };
    }
  },
  
  help: {
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: (args, session) => {
      const commandList = Object.values(commands)
        .map(cmd => `  ${cmd.usage.padEnd(25)} - ${cmd.description}`)
        .join('\n');
      return {
        success: true,
        message: `Available commands:\n${commandList}`
      };
    }
  }
};

export function isSlashCommand(input) {
  return input.startsWith('/');
}

export function getAvailableCommands() {
  return Object.keys(commands).map(key => ({
    name: `/${key}`,
    description: commands[key].description
  }));
}

export function processSlashCommand(input, session) {
  if (!isSlashCommand(input)) {
    return { success: false, message: 'Not a slash command' };
  }
  
  const parts = input.slice(1).split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  // Show help if just "/"
  if (!commandName) {
    return commands.help.handler([], session);
  }
  
  const command = commands[commandName];
  if (!command) {
    const suggestions = Object.keys(commands)
      .filter(key => key.startsWith(commandName))
      .map(key => `/${key}`);
    
    if (suggestions.length > 0) {
      return {
        success: false,
        message: `Unknown command: /${commandName}\nDid you mean: ${suggestions.join(', ')}?`
      };
    }
    
    return {
      success: false,
      message: `Unknown command: /${commandName}\nType /help for available commands`
    };
  }
  
  return command.handler(args, session);
}

export function getCommandSuggestions(input) {
  if (!input.startsWith('/')) return [];
  
  const partial = input.slice(1).toLowerCase();
  if (!partial) {
    // Show all commands if just "/"
    return Object.keys(commands).map(key => `/${key}`);
  }
  
  return Object.keys(commands)
    .filter(key => key.startsWith(partial))
    .map(key => `/${key}`);
}