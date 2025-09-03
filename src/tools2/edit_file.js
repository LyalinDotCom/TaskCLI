import fs from 'node:fs/promises';
import path from 'node:path';
import { Tool, ToolResult } from './base.js';

export class EditFileTool extends Tool {
  constructor() {
    super(
      'edit_file',
      'Edit specific parts of an existing file',
      {
        path: { type: 'string', required: true, description: 'Path to file to edit' },
        edits: { 
          type: 'array', 
          required: true, 
          description: 'Array of find/replace operations',
          schema: {
            find: { type: 'string', description: 'Exact text to find (including whitespace)' },
            replace: { type: 'string', description: 'Text to replace with' }
          }
        }
      }
    );

    this.whenToUse = [
      'Fixing specific errors in code',
      'Updating configuration values',
      'Refactoring function names',
      'Applying targeted fixes from error messages'
    ];

    this.whenNotToUse = [
      'Creating new files (use write_file)',
      'Replacing entire file contents (use write_file)',
      'Complex multi-file refactoring (break into multiple edit_file calls)'
    ];

    this.examples = [
      {
        path: 'src/App.tsx',
        edits: [{ 
          find: 'const countRef = useRef<number>();',
          replace: 'const countRef = useRef<number>(0);'
        }],
        description: 'Fix TypeScript error by adding initial value'
      }
    ];
  }

  async execute(params, context) {
    this.validateParams(params);
    
    const { path: filePath, edits } = params;
    const cwd = context.cwd || process.cwd();
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    try {
      // Read current content
      let content = await fs.readFile(fullPath, 'utf-8');
      const originalContent = content;
      
      // Apply edits
      let totalReplacements = 0;
      const appliedEdits = [];

      for (const edit of edits) {
        const { find, replace } = edit;
        
        if (!content.includes(find)) {
          return ToolResult.failure(
            `Could not find text to replace: "${find.substring(0, 50)}${find.length > 50 ? '...' : ''}"`,
            { path: filePath, edit, suggestion: 'Make sure the find text exactly matches the file content including whitespace' }
          );
        }

        // Count occurrences
        const occurrences = content.split(find).length - 1;
        
        // Replace all occurrences
        content = content.split(find).join(replace);
        totalReplacements += occurrences;
        
        appliedEdits.push({
          find: find.substring(0, 50) + (find.length > 50 ? '...' : ''),
          replace: replace.substring(0, 50) + (replace.length > 50 ? '...' : ''),
          occurrences
        });
      }

      // Write back
      await fs.writeFile(fullPath, content, 'utf-8');

      return ToolResult.success({
        path: filePath,
        editsApplied: appliedEdits,
        totalReplacements,
        linesChanged: this._countChangedLines(originalContent, content)
      });
    } catch (error) {
      return ToolResult.failure(`Failed to edit file: ${error.message}`, { path: filePath });
    }
  }

  _countChangedLines(original, modified) {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    let changes = 0;
    
    const maxLen = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (originalLines[i] !== modifiedLines[i]) changes++;
    }
    
    return changes;
  }
}