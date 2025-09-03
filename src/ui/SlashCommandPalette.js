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
  
  // Filter commands based on input
  const query = input.startsWith('/') ? input.substring(1).toLowerCase() : '';
  const filteredCommands = React.useMemo(() => {
    if (!query) return SLASH_COMMANDS;
    
    return SLASH_COMMANDS.filter(cmd => {
      const cmdName = cmd.command.substring(1).toLowerCase();
      return cmdName.startsWith(query) || cmdName.includes(query);
    });
  }, [query]);

  // Reset selection when filtered list changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Keyboard navigation
  React.useEffect(() => {
    const handleKeyPress = (key) => {
      if (key === 'up') {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key === 'down') {
        setSelectedIndex(prev => Math.min(filteredCommands.length - 1, prev + 1));
      } else if (key === 'return' || key === 'tab') {
        if (filteredCommands[selectedIndex]) {
          onSelect(filteredCommands[selectedIndex].command);
        }
      }
    };

    // This would need to be integrated with Ink's useInput hook in the parent component
    return () => {};
  }, [selectedIndex, filteredCommands, onSelect]);

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
      h(Text, { color: 'gray', dimColor: true }, '↑↓ navigate, ↵ select, ESC cancel')
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
    } else if (key.tab || (key.return && showPalette)) {
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex].command);
      }
      return true;
    } else if (key.escape) {
      setShowPalette(false);
      return true;
    }
    return false;
  }, [showPalette, input, selectedIndex, handleSelect]);

  return {
    showPalette,
    selectedIndex,
    handleSelect,
    handleKeyNavigation,
    setShowPalette
  };
}