import fs from 'node:fs/promises';
import path from 'node:path';
import { Tool, ToolResult } from './base.js';

export class ReadFileTool extends Tool {
  constructor() {
    super(
      'read_file',
      'Read contents of a file',
      {
        path: { type: 'string', required: true, description: 'Path to the file to read' },
        start_line: { type: 'number', required: false, description: 'Starting line number (1-indexed)' },
        end_line: { type: 'number', required: false, description: 'Ending line number (inclusive)' }
      }
    );

    this.whenToUse = [
      'Examining files mentioned in error messages',
      'Understanding existing code before making changes',
      'Verifying file contents after edits'
    ];

    this.whenNotToUse = [
      'Searching for patterns across files (use search_code)',
      'Listing directory contents (use run_command with ls)'
    ];

    this.examples = [
      { path: 'src/App.tsx', description: 'Read entire file' },
      { path: 'src/App.tsx', start_line: 25, end_line: 35, description: 'Read lines 25-35' }
    ];
  }

  async execute(params, context) {
    this.validateParams(params);
    
    const { path: filePath, start_line, end_line } = params;
    const cwd = context.cwd || process.cwd();
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      let result;
      if (start_line || end_line) {
        const start = (start_line || 1) - 1; // Convert to 0-indexed
        const end = end_line || lines.length;
        const selectedLines = lines.slice(start, end);
        
        result = {
          path: filePath,
          content: selectedLines.join('\n'),
          lines: { start: start + 1, end: end, total: lines.length }
        };
      } else {
        result = {
          path: filePath,
          content,
          lines: { total: lines.length }
        };
      }

      return ToolResult.success(result);
    } catch (error) {
      return ToolResult.failure(`Failed to read file: ${error.message}`, { path: filePath });
    }
  }
}