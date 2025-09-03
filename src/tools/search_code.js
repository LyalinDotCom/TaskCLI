import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ToolResult } from './base.js';

const execAsync = promisify(exec);

export class SearchCodeTool extends Tool {
  constructor() {
    super(
      'search_code',
      'Search for patterns across the codebase using ripgrep',
      {
        pattern: { type: 'string', required: true, description: 'Pattern to search for (regex or text)' },
        file_pattern: { type: 'string', required: false, description: 'File pattern (e.g., *.js, *.tsx)' },
        case_sensitive: { type: 'boolean', required: false, description: 'Case sensitive search (default: false)' },
        max_results: { type: 'number', required: false, description: 'Maximum results to return (default: 50)' }
      }
    );

    this.whenToUse = [
      'Finding where functions or variables are defined',
      'Locating usage patterns across files',
      'Finding similar code patterns',
      'Understanding codebase structure'
    ];

    this.whenNotToUse = [
      'Reading specific known files (use read_file)',
      'Running general commands (use run_command)'
    ];

    this.examples = [
      { pattern: 'useRef', file_pattern: '*.tsx', description: 'Find all useRef usage in TSX files' },
      { pattern: 'TODO|FIXME', description: 'Find all TODO and FIXME comments' }
    ];
  }

  async execute(params, context) {
    this.validateParams(params);
    
    const { 
      pattern, 
      file_pattern, 
      case_sensitive = false,
      max_results = 50 
    } = params;
    
    const cwd = context.cwd || process.cwd();

    // Build ripgrep command
    let command = 'rg';
    
    // Add case sensitivity flag
    if (!case_sensitive) command += ' -i';
    
    // Add max count
    command += ` -m ${max_results}`;
    
    // Add line numbers and file names
    command += ' -n -H';
    
    // Add file pattern if specified
    if (file_pattern) {
      command += ` -g "${file_pattern}"`;
    }
    
    // Add the search pattern (properly escaped)
    const escapedPattern = pattern.replace(/"/g, '\\"');
    command += ` "${escapedPattern}"`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: { ...process.env, FORCE_COLOR: '0' }
      });

      // Parse ripgrep output
      const matches = this._parseRipgrepOutput(stdout);

      return ToolResult.success({
        pattern,
        matchCount: matches.length,
        matches: matches.slice(0, max_results),
        truncated: matches.length > max_results
      });
    } catch (error) {
      // Ripgrep returns exit code 1 when no matches found - that's ok
      if (error.code === 1) {
        return ToolResult.success({
          pattern,
          matchCount: 0,
          matches: []
        });
      }
      
      // Check if ripgrep is not installed
      if (error.message.includes('command not found') || error.message.includes('is not recognized')) {
        // Fallback to grep
        return this._fallbackToGrep(params, context);
      }
      
      return ToolResult.failure(`Search failed: ${error.message}`, { pattern });
    }
  }

  _parseRipgrepOutput(output) {
    if (!output.trim()) return [];
    
    const lines = output.trim().split('\n');
    const matches = [];
    
    for (const line of lines) {
      // Format: filename:lineNumber:content
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        matches.push({
          file: match[1],
          line: parseInt(match[2]),
          content: match[3].trim()
        });
      }
    }
    
    return matches;
  }

  async _fallbackToGrep(params, context) {
    const { pattern, file_pattern, case_sensitive = false } = params;
    const cwd = context.cwd || process.cwd();
    
    let command = 'grep -r -n';
    if (!case_sensitive) command += ' -i';
    command += ` "${pattern.replace(/"/g, '\\"')}"`;
    
    if (file_pattern) {
      command += ` --include="${file_pattern}"`;
    }
    
    command += ' .';

    try {
      const { stdout } = await execAsync(command, {
        cwd,
        maxBuffer: 10 * 1024 * 1024
      });

      const matches = this._parseGrepOutput(stdout);
      
      return ToolResult.success({
        pattern,
        matchCount: matches.length,
        matches: matches.slice(0, 50),
        truncated: matches.length > 50,
        fallback: 'grep'
      });
    } catch (error) {
      if (error.code === 1) {
        return ToolResult.success({
          pattern,
          matchCount: 0,
          matches: [],
          fallback: 'grep'
        });
      }
      return ToolResult.failure(`Search failed: ${error.message}`, { pattern });
    }
  }

  _parseGrepOutput(output) {
    if (!output.trim()) return [];
    
    const lines = output.trim().split('\n');
    const matches = [];
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        matches.push({
          file: match[1].replace(/^\.\//, ''),
          line: parseInt(match[2]),
          content: match[3].trim()
        });
      }
    }
    
    return matches;
  }
}