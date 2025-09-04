import { RunCommandTool } from './run_command.js';
import { ReadFileTool } from './read_file.js';
import { WriteFileTool } from './write_file.js';
import { EditFileTool } from './edit_file.js';
import { SearchCodeTool } from './search_code.js';
import { TaskTrackerTool } from './taskTracker.js';

/**
 * Tool Registry - all available tools
 */
export class ToolRegistry {
  constructor() {
    this.tools = new Map();
    
    // Register all tools
    this.register(new RunCommandTool());
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new EditFileTool());
    this.register(new SearchCodeTool());
    this.register(new TaskTrackerTool());
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name with params
   */
  async execute(toolName, params, context) {
    const tool = this.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    return await tool.execute(params, context);
  }

  /**
   * Get specifications for all tools (for LLM)
   */
  getSpecs() {
    return this.getAll().map(tool => tool.getSpec());
  }

  /**
   * Format tools for inclusion in prompts
   */
  formatForPrompt() {
    const specs = this.getSpecs();
    let prompt = 'AVAILABLE TOOLS:\n\n';
    
    for (const spec of specs) {
      prompt += `## ${spec.name}\n`;
      prompt += `${spec.description}\n\n`;
      
      prompt += 'Parameters:\n';
      for (const [key, config] of Object.entries(spec.parameters)) {
        prompt += `  - ${key} (${config.type}${config.required ? ', required' : ''}): ${config.description}\n`;
      }
      
      if (spec.whenToUse.length > 0) {
        prompt += '\nWhen to use:\n';
        spec.whenToUse.forEach(use => prompt += `  - ${use}\n`);
      }
      
      if (spec.whenNotToUse.length > 0) {
        prompt += '\nWhen NOT to use:\n';
        spec.whenNotToUse.forEach(use => prompt += `  - ${use}\n`);
      }
      
      if (spec.examples.length > 0) {
        prompt += '\nExamples:\n';
        spec.examples.forEach(ex => {
          prompt += `  ${JSON.stringify(ex)}\n`;
        });
      }
      
      prompt += '\n';
    }
    
    return prompt;
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();