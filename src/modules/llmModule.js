const axios = require('axios');
const logger = require('./logger');
const ollamaModule = require('./ollamaModule');

class LLMModule {
    constructor() {
        this.llmType = process.env.LLM_TYPE || 'ollama';
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.claudeApiKey = process.env.CLAUDE_API_KEY;
        this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
        this.claudeModel = process.env.CLAUDE_MODEL || 'claude-2';
    }

    async processMessage(messageData) {
        try {
            switch (this.llmType.toLowerCase()) {
                case 'ollama':
                    return await ollamaModule.processMessage(messageData);
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
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: this.openaiModel,
                    messages: [
                        { role: 'user', content: messageData.message }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId,
                groupName: messageData.groupName,
                message: response.data.choices[0].message.content,
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
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: this.claudeModel,
                    messages: [
                        { role: 'user', content: messageData.message }
                    ],
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

            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId,
                groupName: messageData.groupName,
                message: response.data.content[0].text,
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
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'openai/gpt-3.5-turbo',
                    messages: [
                        { role: 'user', content: messageData.message }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openRouterApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId,
                groupName: messageData.groupName,
                message: response.data.choices[0].message.content,
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenRouter API error:', error);
            throw error;
        }
    }
}

module.exports = new LLMModule();
