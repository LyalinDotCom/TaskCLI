/**
 * Model adapter using the new Google GenAI SDK
 * Uses gemini-2.5-pro for enhanced reasoning
 */

import { GoogleGenAI } from '@google/genai';

export class ModelAdapter {
  constructor(apiKey, thinkingBudget = -1, showThoughts = true) {
    this.ai = new GoogleGenAI({ 
      apiKey: apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY 
    });
    this.thinkingBudget = thinkingBudget; // -1 for dynamic thinking (let model decide)
    this.showThoughts = showThoughts; // Whether to show thinking process
    this.lastThoughts = null; // Store last thought summary
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
        maxOutputTokens: 65536,  // Maximum for Gemini 2.5 Pro
        responseMimeType: 'application/json'  // Force JSON output
      };
      
      // Add thinking configuration if budget is set
      if (this.thinkingBudget !== undefined) {
        config.thinkingConfig = {
          thinkingBudget: this.thinkingBudget,
          includeThoughts: this.showThoughts  // Include thoughts if enabled
        };
      }

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',  // Using 2.5 Pro for enhanced reasoning
        contents: contents,
        config: config
      });

      // Debug: Log raw response structure
      if (process.env.DEBUG_MODEL === '1') {
        console.error('\n[DEBUG] Raw API Response:');
        console.error(JSON.stringify(response, null, 2).substring(0, 1000));
      }

      // Extract thoughts and text from response
      let thoughts = '';
      let responseText = '';
      
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughts += part.text + '\n';
          } else if (part.text) {
            responseText += part.text;
          }
        }
      }
      
      // Store thoughts for later retrieval
      if (thoughts) {
        this.lastThoughts = thoughts.trim();
      }
      
      // Try multiple ways to get the text
      const text = responseText || 
                   response.text || 
                   response.candidates?.[0]?.text ||
                   response.response?.text ||
                   '';
      
      // Log what we're trying to parse
      if (process.env.DEBUG_MODEL === '1' || !text) {
        console.error('\n[DEBUG] Text extraction:');
        console.error('- responseText:', responseText ? responseText.substring(0, 100) : 'empty');
        console.error('- response.text:', response.text ? response.text.substring(0, 100) : 'empty');
        console.error('- candidates[0].text:', response.candidates?.[0]?.text ? response.candidates[0].text.substring(0, 100) : 'empty');
        console.error('- Final text to parse:', text ? text.substring(0, 200) : 'empty');
      }
      
      // Parse JSON response with better error handling
      try {
        if (!text) {
          throw new Error('Empty response from model');
        }
        return JSON.parse(text);
      } catch (parseError) {
        // Try to extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch (innerError) {
            console.error('\n❌ Model Response Parse Error');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Raw response:', text.substring(0, 500));
            if (thoughts) {
              console.error('\nModel thoughts:', thoughts.substring(0, 500));
            }
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            throw new Error(`Invalid JSON in model response: ${innerError.message}`);
          }
        }
        
        console.error('\n❌ Model Response Error - No Valid JSON Found');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('Expected JSON but received:');
        console.error('Raw text:', text);
        console.error('\nFull response object:');
        console.error(JSON.stringify(response, null, 2));
        if (thoughts) {
          console.error('\nModel thoughts:', thoughts);
        }
        console.error('\nDebug Info:');
        console.error('- Response text present:', !!responseText);
        console.error('- Response.text present:', !!response.text);
        console.error('- Candidates present:', !!response.candidates);
        if (response.candidates?.[0]) {
          console.error('- Candidate content:', JSON.stringify(response.candidates[0].content));
        }
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        throw new Error('Model did not return valid JSON. Raw response logged above.');
      }
    } catch (error) {
      // Enhanced error reporting
      if (error.message?.includes('API key')) {
        throw new Error('Invalid or missing API key. Please check GEMINI_API_KEY or GOOGLE_API_KEY.');
      } else if (error.message?.includes('quota')) {
        throw new Error('API quota exceeded. Please wait or upgrade your plan.');
      } else if (error.message?.includes('rate')) {
        throw new Error('Rate limit hit. Please wait a moment and try again.');
      }
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
        maxOutputTokens: 65536  // Maximum for Gemini 2.5 Pro
      };
      
      // Add thinking configuration for text generation too
      if (this.thinkingBudget !== undefined) {
        config.thinkingConfig = {
          thinkingBudget: this.thinkingBudget,
          includeThoughts: this.showThoughts  // Include thoughts if enabled
        };
      }

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: contents,
        config: config
      });

      // Extract thoughts and text from response
      let thoughts = '';
      let responseText = '';
      
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughts += part.text + '\n';
          } else if (part.text) {
            responseText += part.text;
          }
        }
      }
      
      // Store thoughts for later retrieval
      if (thoughts) {
        this.lastThoughts = thoughts.trim();
      }
      
      return responseText || response.text || '';
    } catch (error) {
      // Enhanced error reporting
      if (error.message?.includes('API key')) {
        throw new Error('Invalid or missing API key. Please check GEMINI_API_KEY or GOOGLE_API_KEY.');
      } else if (error.message?.includes('quota')) {
        throw new Error('API quota exceeded. Please wait or upgrade your plan.');
      } else if (error.message?.includes('rate')) {
        throw new Error('Rate limit hit. Please wait a moment and try again.');
      }
      throw error;
    }
  }

  /**
   * Get the last thinking summary
   */
  getLastThoughts() {
    return this.lastThoughts;
  }
}

export function createModelAdapter(thinkingBudget = -1, showThoughts = true) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('No API key found. Model calls will fail.');
  }
  return new ModelAdapter(apiKey, thinkingBudget, showThoughts);
}