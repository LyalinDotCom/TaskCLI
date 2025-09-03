import React from 'react';
import { Box, Text } from 'ink';

const h = React.createElement;

// Define available slash commands
const SLASH_COMMANDS = [
  {
    command: '/resume',
    description: 'Resume from previously saved context in this directory',
    category: 'context'
  },
  {
    command: '/save',
    description: 'Save current session context to .taskcli folder',
    category: 'context'
  },
  {
    command: '/status',
    description: 'Show current context status and statistics',
    category: 'context'
  },
  {
    command: '/model',
    description: 'Show current model configuration',
    category: 'config'
  },
  {
    command: '/thinking <number>',
    description: 'Set thinking budget for Gemini Pro (-1 for dynamic)',
    category: 'config'
  },
  {
    command: '/clear',
    description: 'Clear all context and start fresh (both UI and saved state)',
    category: 'context'
  },
  {
    command: '/init',
    description: 'Inspect and understand the project structure (read-only)',
    category: 'context'
  },
  {
    command: '/history',
    description: 'Show command history',
    category: 'ui'
  },
  {
    command: '/help',
    description: 'Show all available commands',
    category: 'general'
  },
  {
    command: '/exit',
    description: 'Exit TaskCLI',
    category: 'general'
  }
];

function CommandItem({ command, description, isSelected, matchedPart }) {
  const getCategoryColor = (cmd) => {
    const cat = SLASH_COMMANDS.find(c => c.command === cmd)?.category;
    switch (cat) {
      case 'context': return 'yellow';
      case 'config': return 'cyan';
      case 'ui': return 'magenta';
      case 'general': return 'white';
      default: return 'gray';
    }
  };

  return h(
    Box,
    { paddingLeft: 1 },
    isSelected ? h(Text, { color: 'green', bold: true }, '▶ ') : h(Text, null, '  '),
    h(Text, { 
      color: isSelected ? getCategoryColor(command) : 'gray',
      bold: isSelected 
    }, 
      matchedPart ? 
        h(React.Fragment, null,
          h(Text, { underline: true }, matchedPart),
          h(Text, null, command.substring(matchedPart.length))
        ) : command
    ),
    h(Text, { color: isSelected ? 'white' : 'gray' }, ' - '),
    h(Text, { 
      color: isSelected ? 'white' : 'gray',
      dimColor: !isSelected 
    }, description)
  );
}

export function SlashCommandPalette({ input, onSelect }) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  
  // Filter commands based on input (prioritize startsWith matches)
  const query = input.startsWith('/') ? input.substring(1).toLowerCase() : '';
  const filteredCommands = React.useMemo(() => {
    if (!query) return SLASH_COMMANDS;
    
    // First get commands that start with the query
    const startsWithMatches = SLASH_COMMANDS.filter(cmd => {
      const cmdName = cmd.command.substring(1).toLowerCase();
      return cmdName.startsWith(query);
    });
    
    // Then get commands that contain but don't start with the query
    const containsMatches = SLASH_COMMANDS.filter(cmd => {
      const cmdName = cmd.command.substring(1).toLowerCase();
      return !cmdName.startsWith(query) && cmdName.includes(query);
    });
    
    // Return startsWith matches first, then contains matches
    return [...startsWithMatches, ...containsMatches];
  }, [query]);

  // Reset selection when filtered list changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Note: Keyboard navigation is handled by the parent component through useSlashCommands hook

  if (filteredCommands.length === 0) {
    return h(
      Box,
      { 
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: 'gray',
        paddingX: 1,
        marginTop: 1
      },
      h(Text, { color: 'gray' }, 'No matching commands found')
    );
  }

  // Group commands by category
  const grouped = React.useMemo(() => {
    const groups = {};
    filteredCommands.forEach(cmd => {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  const getCategoryLabel = (category) => {
    switch (category) {
      case 'context': return '📁 Context';
      case 'config': return '⚙️  Config';
      case 'ui': return '🎨 UI';
      case 'general': return '📋 General';
      default: return category;
    }
  };

  let currentIndex = 0;

  return h(
    Box,
    { 
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 1,
      marginTop: 1,
      width: '100%'
    },
    h(Box, { marginBottom: 1 },
      h(Text, { color: 'cyan', bold: true }, 'Commands '),
      h(Text, { color: 'gray' }, `(${filteredCommands.length} available) `),
      h(Text, { color: 'gray', dimColor: true }, '↑↓ navigate, Tab complete, ↵ select, ESC cancel')
    ),
    ...Object.entries(grouped).map(([category, commands]) => 
      h(React.Fragment, { key: category },
        h(Box, { marginTop: currentIndex > 0 ? 1 : 0 },
          h(Text, { color: 'white', bold: true }, getCategoryLabel(category))
        ),
        ...commands.map(cmd => {
          const isSelected = currentIndex === selectedIndex;
          const element = h(CommandItem, {
            key: cmd.command,
            command: cmd.command,
            description: cmd.description,
            isSelected,
            matchedPart: query ? `/${query}` : null
          });
          currentIndex++;
          return element;
        })
      )
    )
  );
}

// Hook to manage slash command palette state
export function useSlashCommands(input, setInput) {
  const [showPalette, setShowPalette] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  // Auto-complete functionality for tab key
  const handleTabComplete = React.useCallback(() => {
    if (!input.startsWith('/')) return null;
    
    const query = input.substring(1).toLowerCase();
    const filtered = SLASH_COMMANDS.filter(cmd => {
      const cmdName = cmd.command.substring(1).toLowerCase();
      return cmdName.startsWith(query);
    });
    
    if (filtered.length === 1) {
      // If there's exactly one match, complete to it
      const baseCommand = filtered[0].command.split(' ')[0];
      return baseCommand;
    } else if (filtered.length > 1) {
      // Find common prefix among all matches
      const commands = filtered.map(c => c.command);
      let commonPrefix = '/';
      for (let i = 1; i < commands[0].length; i++) {
        const char = commands[0][i];
        if (commands.every(cmd => cmd[i] === char)) {
          commonPrefix += char;
        } else {
          break;
        }
      }
      // Only complete if common prefix is longer than current input
      if (commonPrefix.length > input.length) {
        return commonPrefix;
      }
    }
    return null;
  }, [input]);

  React.useEffect(() => {
    if (input.startsWith('/') && input.length > 0) {
      setShowPalette(true);
    } else {
      setShowPalette(false);
      setSelectedIndex(0);
    }
  }, [input]);

  const handleSelect = React.useCallback((command) => {
    // Extract just the command part without parameters
    const baseCommand = command.split(' ')[0];
    setInput(baseCommand);
    setShowPalette(false);
  }, [setInput]);

  const handleKeyNavigation = React.useCallback((key) => {
    if (!showPalette) return false;

    const query = input.substring(1).toLowerCase();
    const filtered = SLASH_COMMANDS.filter(cmd => {
      const cmdName = cmd.command.substring(1).toLowerCase();
      return cmdName.startsWith(query) || cmdName.includes(query);
    });

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return true;
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filtered.length - 1, prev + 1));
      return true;
    } else if (key.tab) {
      // Tab completes to the first matching command or common prefix
      const completion = handleTabComplete();
      if (completion) {
        setInput(completion);
        // Keep palette open if there are multiple matches
        if (filtered.length === 1) {
          setShowPalette(false);
        }
      }
      return true;
    } else if (key.return && showPalette) {
      // Return selects the currently highlighted command
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex].command);
      }
      return true;
    } else if (key.escape) {
      setShowPalette(false);
      return true;
    }
    return false;
  }, [showPalette, input, selectedIndex, handleSelect, setInput, handleTabComplete]);

  return {
    showPalette,
    selectedIndex,
    handleSelect,
    handleKeyNavigation,
    setShowPalette,
    handleTabComplete
  };
}