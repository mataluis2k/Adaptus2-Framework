const axios = require('axios');
const logger = require('./logger');
const ollamaModule = require('./ollamaModule');
const path = require('path');
const fs = require('fs');

class LLMModule {
    constructor() {
        // Initialize conversation history storage
        this.conversationHistory = new Map();
        this.maxContextLength = 10; // Maximum number of messages to keep in context
        this.llmType = process.env.LLM_TYPE || 'ollama';
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.claudeApiKey = process.env.CLAUDE_API_KEY;
        this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o'; // Default to GPT-4o if not specified
        this.claudeModel = process.env.CLAUDE_MODEL || 'claude-2';
        this.personasConfig = this.loadPersonas();
    }

    loadPersonas() {
        try {
            const personaFile = path.join(process.env.CONFIG_DIR, 'personas.json');
            const data = fs.readFileSync(personaFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('Failed to load personas.json:', error);
            return {};
        }
    }

    buildPersonaPrompt(personaName) {
        const persona = this.personasConfig[personaName];
        if (!persona) {
            logger.warn(`Persona "${personaName}" not found in config`);
            return '';
        }
        
        console.log(`Using persona: ${personaName}`);
        return `${persona.behaviorInstructions || ''}\n${persona.functionalDirectives || ''}\n${persona.knowledgeConstraints || ''}\n${persona.ethicalGuidelines || ''}\n`;
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
    
    getPersonasWithDescriptions() {
        return Object.entries(this.personasConfig).map(([persona, config]) => ({
            persona,
            description: config.description || 'No description provided'
        }));
    }
      
    // Function to detect if user is explicitly requesting a specific persona
detectRequestedPersona(message) {
    if (!message) return { requestedPersona: null, cleanedMessage: message };
    
    // Get all persona names to check against user message
    const personaNames = Object.keys(this.personasConfig);
    if (personaNames.length === 0) {
        return { requestedPersona: null, cleanedMessage: message };
    }
    
    // Common request patterns
    const requestPatterns = [
        // Direct requests
        /I\s+need\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:to|that)/i,
        /I\s+want\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:to|that)/i,
        /(?:get|give)\s+me\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:to|that)/i,
        /can\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+help/i,
        /let\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:handle|answer)/i,
        
        // Persona-first patterns
        /^([a-zA-Z\s]+)\s*[:,.]\s*(.*)/i,
        /^(?:as|like)\s+(?:a|an|the)\s+([a-zA-Z\s]+)[,.:]\s*(.*)/i
    ];
    
    // Check each pattern
    for (const pattern of requestPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            const potentialPersona = match[1].trim().toLowerCase();
            
            // Find best matching persona
            let bestMatch = null;
            let bestMatchScore = 0;
            
            for (const personaName of personaNames) {
                // Check for exact match or contained match
                if (personaName.toLowerCase() === potentialPersona) {
                    // Return immediately for exact match
                    const cleanedMessage = this.removePersonaRequest(message, match[0]);
                    return { requestedPersona: personaName, cleanedMessage };
                }
                
                // Check for partial matches
                if (personaName.toLowerCase().includes(potentialPersona) ||
                    potentialPersona.includes(personaName.toLowerCase())) {
                    const score = this.calculateMatchScore(personaName.toLowerCase(), potentialPersona);
                    if (score > bestMatchScore) {
                        bestMatchScore = score;
                        bestMatch = personaName;
                    }
                }
            }
            
            // If we found a good match, return it
            if (bestMatch && bestMatchScore > 0.5) {
                const cleanedMessage = this.removePersonaRequest(message, match[0]);
                return { requestedPersona: bestMatch, cleanedMessage };
            }
        }
    }
    
    return { requestedPersona: null, cleanedMessage: message };
}

// Calculate how well two strings match (simple score)
calculateMatchScore(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.includes(shorter)) {
        return shorter.length / longer.length;
    }
    
    // Count matching characters
    let matchCount = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) {
            matchCount++;
        }
    }
    
    return matchCount / longer.length;
}

// Remove the persona request from the message
removePersonaRequest(message, matchedRequest) {
    if (!matchedRequest) return message;
    
    // Replace the matched request with empty string
    const cleanedMessage = message.replace(matchedRequest, '').trim();
    
    // If there's content remaining, return it, otherwise return original
    // (this avoids completely emptying the message)
    return cleanedMessage.length > 0 ? cleanedMessage : message;
}
    async selectPersona(message, personaList) {
        if (!personaList || personaList.length === 0) {
            logger.warn('No personas available for selection');
            return null;
        }

        // If there's only one persona, just use it without calling LLM
        if (personaList.length === 1) {
            logger.info(`Only one persona available (${personaList[0].persona}), using it automatically`);
            return personaList[0].persona;
        }

        // Create a complete message data object with all required fields
        const messageDataCopy = { 
            senderId: 'persona_selector', 
            recipientId: 'system',
            message: message,
            groupName: null,
            timestamp: new Date().toISOString(),
            status: 'processing'
        };

        let list = JSON.stringify(personaList, null, 2);
        const llmPrompt = `
        You are tasked with selecting the most suitable persona from the list below to answer the user's question.
        
        Each persona has a name and a brief description of its expertise:
        
        ${list}
        
        User's question: "${message}"
        
        Instructions:
        - Review the personas and their descriptions.
        - Determine which persona is best equipped to answer the user's question based on their expertise.
        - Respond with **only the persona's name** (the exact name from the list) that is most suitable.
        - Do not provide any explanation or additional text.
        
        Return format:
        <persona_name>
        `;

        messageDataCopy.message = llmPrompt;
        
        try {
            // Use a simpler LLM call that doesn't add to the main conversation history
            const response = await this.simpleLLMCall(messageDataCopy);
            
            if (!response || !response.message) {
                logger.warn('No response from persona selector, using default persona');
                // Use the first persona as default if available
                return personaList[0]?.persona || null;
            }
            
            // Extract just the persona name from response
            // First, try to extract a name between angle brackets
            let personaName = response.message.trim();
            const bracketMatch = personaName.match(/<([^>]+)>/);
            if (bracketMatch) {
                personaName = bracketMatch[1].trim();
            } else {
                // If no brackets, use the first line or whole response
                personaName = personaName.split('\n')[0].trim();
            }
            
            // Verify the persona exists in our config
            if (this.personasConfig[personaName]) {
                logger.info(`Selected persona: ${personaName}`);
                return personaName;
            } else {
                // Try to find a close match in case the model didn't return the exact name
                const closestPersona = this.findClosestPersona(personaName);
                if (closestPersona) {
                    logger.info(`Using closest matching persona: ${closestPersona}`);
                    return closestPersona;
                }
                
                logger.warn(`Selected persona "${personaName}" not found in config, using default`);
                // Use the first persona as default if available
                return personaList[0]?.persona || null;
            }
        } catch (error) {
            logger.error('Error selecting persona:', error);
            // Use the first persona as default if available
            return personaList[0]?.persona || null;
        }
    }
    
    // Helper method to find the closest persona name match
    findClosestPersona(personaName) {
        if (!personaName) return null;
        
        // Convert to lowercase for case-insensitive matching
        const lowerPersonaName = personaName.toLowerCase();
        
        // Check if any persona name contains this string
        for (const [name, _] of Object.entries(this.personasConfig)) {
            if (name.toLowerCase() === lowerPersonaName) {
                return name; // Exact match (case-insensitive)
            }
        }
        
        // Check if this string is contained in any persona name
        for (const [name, _] of Object.entries(this.personasConfig)) {
            if (name.toLowerCase().includes(lowerPersonaName) || 
                lowerPersonaName.includes(name.toLowerCase())) {
                return name; // Partial match
            }
        }
        
        return null; // No match found
    }

    // Simple LLM call for internal use (persona selection) that doesn't affect the main conversation
    async simpleLLMCall(messageData) {
        try {
            // Ensure all required fields are present to prevent DB errors
            const safeMessageData = {
                senderId: messageData.senderId || 'persona_selector',
                recipientId: messageData.recipientId || 'system',
                message: messageData.message,
                groupName: messageData.groupName || null,
                timestamp: messageData.timestamp || new Date().toISOString(),
                status: 'processing'
            };
            
            switch (this.llmType.toLowerCase()) {
                case 'ollama':
                    // Pass empty history to avoid affecting main conversation
                    return await ollamaModule.processMessage(safeMessageData, []);
                case 'openai':
                    return await this.callOpenAI([{ role: 'user', content: safeMessageData.message }]);
                case 'claude':
                    return await this.callClaude([{ role: 'user', content: safeMessageData.message }]);
                case 'openrouter':
                    return await this.callOpenRouter([{ role: 'user', content: safeMessageData.message }]);
                default:
                    throw new Error(`Unsupported LLM type for persona selection: ${this.llmType}`);
            }
        } catch (error) {
            logger.error('Error in simple LLM call:', error);
            // Return a fallback response instead of throwing
            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId || 'user',
                message: 'default', // Use a default persona name
                status: 'delivered'
            };
        }
    }

    async processMessage(messageData) {
        logger.info(`Processing message from ${messageData.senderId}`);
        
        try {
            if (!messageData || !messageData.senderId || !messageData.message) {
                throw new Error('Invalid message data');
            }
            
            // Initialize conversation history if needed
            if (!this.conversationHistory.has(messageData.senderId)) {
                this.conversationHistory.set(messageData.senderId, []);
            }
            
            // Store the original user message
            const originalMessage = messageData.message;
            
            // Step 1: Check if user is explicitly requesting a specific persona
            const { requestedPersona, cleanedMessage } = this.detectRequestedPersona(originalMessage);
            
            // Step 2: If user didn't request a specific persona, select one automatically
            let personaName = requestedPersona;
            if (!personaName) {
                const personaList = this.getPersonasWithDescriptions();
                personaName = await this.selectPersona(originalMessage, personaList);
            } else {
                logger.info(`User explicitly requested persona: ${personaName}`);
            }
            
            // Step 3: Build the persona-enhanced prompt if a persona was selected
            let enhancedMessage;
            let messageToProcess;
            
            if (personaName) {
                // If we found a persona request, use the cleaned message
                messageToProcess = requestedPersona ? cleanedMessage : originalMessage;
                const personaPrompt = this.buildPersonaPrompt(personaName);
                
                if (personaPrompt) {
                    // Format the enhanced message with the persona instructions
                    enhancedMessage = `<s>\n${personaPrompt}\n</s>\n\nUser message: ${messageToProcess}`;
                    logger.info(`Enhanced message with persona: ${personaName}`);
                } else {
                    enhancedMessage = messageToProcess;
                }
            } else {
                enhancedMessage = originalMessage;
                messageToProcess = originalMessage;
            }
            
            // Step 4: Add the user's original message to conversation history
            this.addToHistory(messageData.senderId, originalMessage, 'user');
            
            // Step 5: Create a modified message data object for the LLM call
            const enhancedMessageData = {
                ...messageData,
                message: enhancedMessage,
                // Track which persona was used for logging/debugging
                _personaUsed: personaName || 'none',
                _originalMessage: originalMessage,
                _processedMessage: messageToProcess
            };
            
            // Step 6: Call the LLM with the enhanced message
            return await this.callLLM(enhancedMessageData);
            
        } catch (error) {
            logger.error('Error processing message:', error);
            throw error;
        }
    }

    async callLLM(messageData) {
        logger.info(`Calling LLM (${this.llmType}) for ${messageData.senderId}`);
        
        // Ensure messageData has all required fields to prevent DB errors
        const safeMessageData = {
            senderId: messageData.senderId || 'user',
            recipientId: messageData.recipientId || 'AI_Assistant',
            message: messageData.message || '',
            groupName: messageData.groupName || null,
            timestamp: messageData.timestamp || new Date().toISOString(),
            status: messageData.status || 'processing'
        };
        
        try {
            if (!this.llmType) {
                throw new Error('LLM type not configured');
            }
            
            // Note: We're NOT adding the enhanced message to history here
            // The original user message was already added in processMessage()
            
            // Process based on LLM type
            let response;
            
            switch (this.llmType.toLowerCase()) {
                case 'ollama':
                    const ollamaHistory = this.getHistory(safeMessageData.senderId);
                    response = await ollamaModule.processMessage(safeMessageData, ollamaHistory);
                    break;
                    
                case 'openai':
                    const openaiHistory = this.getHistory(safeMessageData.senderId);
                    // For OpenAI, we need to add the enhanced message right before calling
                    const tempOpenAIHistory = [...openaiHistory];
                    if (tempOpenAIHistory.length > 0) {
                        tempOpenAIHistory.pop(); // Remove the original user message
                    }
                    tempOpenAIHistory.push({ role: 'user', content: safeMessageData.message }); // Add enhanced message
                    response = await this.callOpenAI(tempOpenAIHistory);
                    break;
                    
                case 'claude':
                    const claudeHistory = this.getHistory(safeMessageData.senderId);
                    // Similar approach for Claude
                    const tempClaudeHistory = [...claudeHistory];
                    if (tempClaudeHistory.length > 0) {
                        tempClaudeHistory.pop(); // Remove the original user message
                    }
                    tempClaudeHistory.push({ role: 'user', content: safeMessageData.message }); // Add enhanced message
                    response = await this.callClaude(tempClaudeHistory);
                    break;
                    
                case 'openrouter':
                    const openRouterHistory = this.getHistory(safeMessageData.senderId);
                    // And for OpenRouter
                    const tempOpenRouterHistory = [...openRouterHistory];
                    if (tempOpenRouterHistory.length > 0) {
                        tempOpenRouterHistory.pop(); // Remove the original user message
                    }
                    tempOpenRouterHistory.push({ role: 'user', content: safeMessageData.message }); // Add enhanced message
                    response = await this.callOpenRouter(tempOpenRouterHistory);
                    break;
                    
                default:
                    throw new Error(`Unsupported LLM type: ${this.llmType}`);
            }
            
            // Make sure response is well-formed
            if (!response) {
                throw new Error('No response from LLM');
            }
            
            // Ensure all required fields are present
            const safeResponse = {
                senderId: response.senderId || 'AI_Assistant',
                recipientId: response.recipientId || safeMessageData.senderId,
                message: response.message || 'Sorry, I could not generate a response.',
                groupName: response.groupName || safeMessageData.groupName,
                timestamp: response.timestamp || new Date().toISOString(),
                status: response.status || 'delivered'
            };
            
            // Add to history only after ensuring the response is valid
            this.addToHistory(safeMessageData.senderId, safeResponse.message, 'assistant');
            
            return safeResponse;
            
        } catch (error) {
            logger.error('Error calling LLM:', error);
            
            // Return a graceful error response instead of throwing
            return {
                senderId: 'AI_Assistant',
                recipientId: safeMessageData.senderId,
                message: 'I apologize, but I encountered an error processing your request. Please try again.',
                groupName: safeMessageData.groupName,
                timestamp: new Date().toISOString(),
                status: 'error'
            };
        }
    }

    async callOpenAI(messages) {
        if (!this.openaiApiKey) {
            throw new Error('OpenAI API key not configured');
        }

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: this.openaiModel,
                    messages: messages
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;

            return {
                senderId: 'AI_Assistant',
                recipientId: 'user', // Ensure this is never undefined
                groupName: null, // Ensure DB fields are always defined
                message: assistantMessage || '', // Ensure not undefined
                timestamp: new Date().toISOString(),
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenAI API error:', error);
            throw error;
        }
    }

    async callClaude(messages) {
        if (!this.claudeApiKey) {
            throw new Error('Claude API key not configured');
        }

        try {
            // Convert to Claude API format
            const claudeMessages = messages.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            }));

            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: this.claudeModel,
                    messages: claudeMessages,
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

            return {
                senderId: 'AI_Assistant',
                recipientId: 'user', // Ensure this is never undefined
                groupName: null, // Ensure DB fields are always defined
                message: assistantMessage || '', // Ensure not undefined
                timestamp: new Date().toISOString(),
                status: 'delivered'
            };
        } catch (error) {
            logger.error('Claude API error:', error);
            throw error;
        }
    }

    async callOpenRouter(messages) {
        if (!this.openRouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'openai/gpt-3.5-turbo',
                    messages: messages
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openRouterApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;

            return {
                senderId: 'AI_Assistant',
                recipientId: 'user', // Ensure this is never undefined
                groupName: null, // Ensure DB fields are always defined
                message: assistantMessage || '', // Ensure not undefined
                timestamp: new Date().toISOString(),
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenRouter API error:', error);
            throw error;
        }
    }
}

module.exports = new LLMModule();