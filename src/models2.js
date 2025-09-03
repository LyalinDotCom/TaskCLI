/**
 * Model adapter using the new Google GenAI SDK
 * Uses gemini-2.5-pro for enhanced reasoning
 */

import { GoogleGenAI } from '@google/genai';

export class ModelAdapter {
  constructor(apiKey, thinkingBudget = -1) {
    this.ai = new GoogleGenAI({ 
      apiKey: apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY 
    });
    this.thinkingBudget = thinkingBudget; // -1 for dynamic thinking (let model decide)
  }

  /**
   * Generate structured JSON response for agent actions
   */
  async generateAction(prompt, history = [], temperature = 0.1) {
    try {
      // Convert history to the format expected by the new SDK
      const contents = [];
      
      // Add history messages
      for (const msg of history) {
        if (msg.role === 'system') {
          // System messages become user messages in the new SDK
          contents.push({
            role: 'user',
            parts: [{ text: `[System]: ${msg.content}` }]
          });
        } else if (msg.role === 'assistant') {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }]
          });
        } else {
          contents.push({
            role: msg.role,
            parts: [{ text: msg.content }]
          });
        }
      }
      
      // Add the current prompt as the latest user message
      contents.push({
        role: 'user',
        parts: [{ text: prompt }]
      });

      const config = {
        temperature,
        maxOutputTokens: 4096,  // Increased for complex responses
        responseMimeType: 'application/json'  // Force JSON output
      };
      
      // Add thinking configuration if budget is set
      if (this.thinkingBudget !== undefined) {
        config.thinkingConfig = {
          thinkingBudget: this.thinkingBudget,
          includeThoughts: false  // We don't need thought summaries for agent actions
        };
      }

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',  // Using 2.5 Pro for enhanced reasoning
        contents: contents,
        config: config
      });

      // Parse JSON response
      try {
        const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON:', response.text);
        
        // Try to extract JSON from response
        const jsonMatch = response.text?.match(/\{[\s\S]*\}/);
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
      // Convert history to the format expected by the new SDK
      const contents = [];
      
      for (const msg of history) {
        if (msg.role === 'system') {
          contents.push({
            role: 'user',
            parts: [{ text: `[System]: ${msg.content}` }]
          });
        } else if (msg.role === 'assistant') {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }]
          });
        } else {
          contents.push({
            role: msg.role,
            parts: [{ text: msg.content }]
          });
        }
      }
      
      // Add the current prompt
      contents.push({
        role: 'user',
        parts: [{ text: prompt }]
      });

      const config = {
        temperature,
        maxOutputTokens: 8192
      };
      
      // Add thinking configuration for text generation too
      if (this.thinkingBudget !== undefined) {
        config.thinkingConfig = {
          thinkingBudget: this.thinkingBudget,
          includeThoughts: false  // Keep responses clean
        };
      }

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: contents,
        config: config
      });

      return response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error) {
      console.error('Model error:', error);
      throw error;
    }
  }
}

export function createModelAdapter(thinkingBudget = -1) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('No API key found. Model calls will fail.');
  }
  return new ModelAdapter(apiKey, thinkingBudget);
}