export function planningPrompt({ goal, memorySummary, cwd }) {
  return `You are TaskCLI's planning brain (Gemini Flash). Your job is to break down the user's goal into a clear, executable task list for a coding-oriented CLI.

CONTEXT
- Working directory: ${cwd}
- Memory summary: ${memorySummary || 'None yet'}

REQUIREMENTS
- Output strictly as JSON with a top-level object {"tasks": Task[]} with no extra prose.
- Prefer many small, safe steps over one giant step.
- Use only these task types:
  - write_file { path: string, content_prompt?: string, content?: string }
  - read_file { path: string }
  - run_command { command: string, cwd?: string, confirm?: boolean }
  - search_web { query: string, numResults?: number }
  - generate_file_from_prompt { path: string, prompt: string }
  - edit_file { path: string, instruction: string }
- If code/content must be generated, do NOT inline it here. Provide a concise 'content_prompt' or 'prompt' that the Pro model will use to generate high-quality code.
- Use relative paths under the working dir. Ensure parent folders exist implicitly.
- Always include a short title and rationale for each task.

GOAL
${goal}

Return JSON only, like:
{"tasks":[
  {"id":"T1","type":"run_command","title":"Init project","rationale":"Bootstrap Node app","command":"npm init -y"},
  {"id":"T2","type":"write_file","title":"Create README","rationale":"Docs","path":"README.md","content_prompt":"Write concise usage and setup for TaskCLI"},
  {"id":"T3","type":"generate_file_from_prompt","title":"Main module","rationale":"Core logic","path":"src/index.js","prompt":"Implement X with Y interfaces"}
]}`;
}

export function codeGenPrompt({ instruction, context }) {
  return `You are TaskCLI's coding brain (Gemini Pro). Produce complete, high-quality code.

INSTRUCTION
${instruction}

CONTEXT
${context || 'N/A'}

OUTPUT
- Return only the final code content. No markdown fences, no commentary.`;
}

export function editFilePrompt({ filepath, currentContent, instruction, context }) {
  return `You are TaskCLI's coding brain (Gemini Pro). Edit the provided file based on the instruction.

FILE PATH
${filepath}

CURRENT CONTENT
${currentContent}

INSTRUCTION
${instruction}

CONTEXT
${context || 'N/A'}

OUTPUT
- Return only the full updated file content. No comments or fences.`;
}

