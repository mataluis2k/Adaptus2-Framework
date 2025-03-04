const axios = require('axios');
const logger = require('./logger');
const ollamaModule = require('./ollamaModule');

class LLMModule {
    constructor() {
        // Initialize conversation history storage
        this.conversationHistory = new Map();
        this.maxContextLength = 10; // Maximum number of messages to keep in context
        this.llmType = process.env.LLM_TYPE || 'ollama';
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.claudeApiKey = process.env.CLAUDE_API_KEY;
        this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
        this.claudeModel = process.env.CLAUDE_MODEL || 'claude-2';
    }

    // Add message to conversation history
    addToHistory(sessionId, message, role = 'user') {
        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        
        const history = this.conversationHistory.get(sessionId);
        history.push({ role, content: message });
        
        // Maintain context window
        if (history.length > this.maxContextLength * 2) { // *2 because we store both user and assistant messages
            history.splice(0, 2); // Remove oldest message pair
        }
        
        this.conversationHistory.set(sessionId, history);
    }

    // Get conversation history for a session
    getHistory(sessionId) {
        return this.conversationHistory.get(sessionId) || [];
    }

    async processMessage(messageData) {
        try {
            // Add user message to history
            this.addToHistory(messageData.senderId, messageData.message, 'user');
            
            let response;
            switch (this.llmType.toLowerCase()) {
                case 'ollama':
                    const ollamaHistory = this.getHistory(messageData.senderId);
                    const ollamaResponse = await ollamaModule.processMessage(messageData, ollamaHistory);
                    this.addToHistory(messageData.senderId, ollamaResponse.message, 'assistant');
                    return ollamaResponse;
                case 'openai':
                    return await this.processOpenAI(messageData);
                case 'claude':
                    return await this.processClaude(messageData);
                case 'openrouter':
                    return await this.processOpenRouter(messageData);
                default:
                    throw new Error(`Unsupported LLM type: ${this.llmType}`);
            }
        } catch (error) {
            logger.error('Error processing message:', error);
            throw error;
        }
    }

    async processOpenAI(messageData) {
        if (!this.openaiApiKey) {
            throw new Error('OpenAI API key not configured');
        }

        try {
            const history = this.getHistory(messageData.senderId);
            console.log('history:', history);
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: this.openaiModel,
                    messages: history
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;
            // Add assistant's response to history
            this.addToHistory(messageData.senderId, assistantMessage, 'assistant');

            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId,
                groupName: messageData.groupName,
                message: assistantMessage,
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenAI API error:', error);
            throw error;
        }
    }

    async processClaude(messageData) {
        if (!this.claudeApiKey) {
            throw new Error('Claude API key not configured');
        }

        try {
            const history = this.getHistory(messageData.senderId);
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: this.claudeModel,
                    messages: history,
                    max_tokens: 1000
                },
                {
                    headers: {
                        'x-api-key': this.claudeApiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.content[0].text;
            // Add assistant's response to history
            this.addToHistory(messageData.senderId, assistantMessage, 'assistant');

            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId,
                groupName: messageData.groupName,
                message: assistantMessage,
                status: 'delivered'
            };
        } catch (error) {
            logger.error('Claude API error:', error);
            throw error;
        }
    }

    async processOpenRouter(messageData) {
        if (!this.openRouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        try {
            const history = this.getHistory(messageData.senderId);
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'openai/gpt-3.5-turbo',
                    messages: history
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openRouterApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;
            // Add assistant's response to history
            this.addToHistory(messageData.senderId, assistantMessage, 'assistant');

            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId,
                groupName: messageData.groupName,
                message: assistantMessage,
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenRouter API error:', error);
            throw error;
        }
    }
}

module.exports = new LLMModule();
