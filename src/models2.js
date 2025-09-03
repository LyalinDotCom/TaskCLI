/**
 * Simplified model interface for v2 architecture
 * Handles JSON structured output reliably
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export class ModelAdapter {
  constructor(apiKey, thinkingBudget = 8000) {
    this.genAI = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    this.thinkingBudget = thinkingBudget;
  }

  /**
   * Generate structured JSON response
   */
  async generateAction(prompt, history = [], temperature = 0.1) {
    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-thinking-exp',
        generationConfig: {
          temperature,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'  // Force JSON output
        }
      });

      // Build chat history - map roles to Google AI format
      const chat = model.startChat({
        history: history.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
          parts: [{ text: msg.content }]
        }))
      });

      // Send message and get response
      const result = await chat.sendMessage(prompt);
      const response = result.response.text();

      // Parse JSON
      try {
        return JSON.parse(response);
      } catch (e) {
        console.error('Failed to parse JSON:', response);
        
        // Try to extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        
        throw new Error('No valid JSON in response');
      }
    } catch (error) {
      console.error('Model error:', error);
      throw error;
    }
  }

  /**
   * Generate text response (for general prompts)
   */
  async generateText(prompt, history = [], temperature = 0.7) {
    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-thinking-exp',
        generationConfig: {
          temperature,
          maxOutputTokens: 8192
        }
      });

      const chat = model.startChat({
        history: history.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : msg.role === 'system' ? 'user' : msg.role,
          parts: [{ text: msg.content }]
        }))
      });

      const result = await chat.sendMessage(prompt);
      return result.response.text();
    } catch (error) {
      console.error('Model error:', error);
      throw error;
    }
  }
}

export function createModelAdapter() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('No API key found. Model calls will fail.');
  }
  return new ModelAdapter(apiKey);
}