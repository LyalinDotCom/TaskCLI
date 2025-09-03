/**
 * Base tool class that all tools extend from
 */
export class Tool {
  constructor(name, description, parameters, examples) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.examples = examples || [];
    this.whenToUse = [];
    this.whenNotToUse = [];
  }

  /**
   * Validate parameters before execution
   */
  validateParams(params) {
    for (const [key, config] of Object.entries(this.parameters)) {
      if (config.required && !(key in params)) {
        throw new Error(`Missing required parameter: ${key}`);
      }
      if (key in params && config.type) {
        const actualType = typeof params[key];
        if (actualType !== config.type && !(config.type === 'array' && Array.isArray(params[key]))) {
          throw new Error(`Parameter ${key} must be of type ${config.type}, got ${actualType}`);
        }
      }
    }
    return true;
  }

  /**
   * Execute the tool - must be implemented by subclasses
   */
  async execute(params, context) {
    throw new Error('Tool.execute() must be implemented by subclass');
  }

  /**
   * Get tool specification for LLM
   */
  getSpec() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      whenToUse: this.whenToUse,
      whenNotToUse: this.whenNotToUse,
      examples: this.examples
    };
  }
}

/**
 * Tool execution result
 */
export class ToolResult {
  constructor(success, data, error = null) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.timestamp = new Date().toISOString();
  }

  static success(data) {
    return new ToolResult(true, data, null);
  }

  static failure(error, data = null) {
    return new ToolResult(false, data, error);
  }
}