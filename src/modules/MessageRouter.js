// MessageRouter.js - Responsible for message routing, analysis and processing decisions
// Coordinates with various components to determine optimal processing paths
// Part of the optimized chat architecture design

const llmModule = require('./llmModule');

class MessageRouter {
    constructor(responseEngine) {
        this.responseEngine = responseEngine;
        this.recentQueries = new Map(); // Store recent queries by session for context
        this.maxRecentQueries = 5; // Number of recent queries to keep per session
    }

    // Record a query for context
    recordQuery(sessionId, message, classification) {
        if (!this.recentQueries.has(sessionId)) {
            this.recentQueries.set(sessionId, []);
        }
        
        const sessionQueries = this.recentQueries.get(sessionId);
        sessionQueries.push({
            message,
            classification,
            timestamp: Date.now()
        });
        
        // Maintain size limit
        if (sessionQueries.length > this.maxRecentQueries) {
            sessionQueries.shift(); // Remove oldest query
        }
        
        this.recentQueries.set(sessionId, sessionQueries);
    }

    // Get recent query context
    getRecentQueries(sessionId) {
        return this.recentQueries.get(sessionId) || [];
    }

    // Main routing function
    async routeMessage(sessionId, message, recipientId, groupName = null) {
        console.log(`[MessageRouter] Routing message from ${sessionId}`);
        
        if (!sessionId || !message) {
            console.error('[MessageRouter] Missing required parameters: sessionId or message');
            return {
                response: "I apologize, but I encountered an error processing your request.",
                persona: "default",
                classification: { type: "error" }
            };
        }
        
        try {
            // Step 1: Detect persona from message
            const { requestedPersona, cleanedMessage } = await llmModule.detectRequestedPersona(message);
            
            // Step 2: If no specific persona detected, select best one for this message
            let selectedPersona = requestedPersona;
            if (!selectedPersona) {
                const personaList = llmModule.getPersonasWithDescriptions();
                selectedPersona = await llmModule.selectPersona(message, personaList);
            }
            
            // Safety check - ensure we have a valid persona
            if (!selectedPersona) {
                console.log('[MessageRouter] No persona selected, using default');
                selectedPersona = 'default';
            }
            
            console.log(`[MessageRouter] Selected persona: ${selectedPersona}`);
            
            // Step 3: Analyze message for context continuation
            const processedMessage = requestedPersona ? cleanedMessage : message;
            const recentQueries = this.getRecentQueries(sessionId);
            
            // Check if this is a follow-up to a recent RAG query
            const isFollowUp = this.isFollowUpQuery(processedMessage, recentQueries);
            
            // Step 4: Classify the message
            const classification = await this.classifyMessage(
                processedMessage, 
                selectedPersona, 
                isFollowUp
            );
            
            // Step 5: Record this query for future context
            this.recordQuery(sessionId, processedMessage, classification);
            
            // Step 6: Get response using the appropriate strategy
            // FIX: Use parameters object with named properties
            const response = await this.responseEngine.generateResponse({
                sessionId,
                message: processedMessage,
                queryType: classification.type,
                persona: selectedPersona,
                context: null,  // Context could be added here if available
                recipientId,
                groupName
            });
            
            return {
                response,
                persona: selectedPersona,
                classification
            };
            
        } catch (error) {
            console.error('[MessageRouter] Error routing message:', error);
            
            // Fallback to simple response
            return {
                response: "I apologize, but I encountered an error processing your request. Please try again.",
                persona: "default",
                classification: { type: "error" }
            };
        }
    }
    

    // Check if a message is a follow-up to recent queries
    isFollowUpQuery(message, recentQueries) {
        if (recentQueries.length === 0) return false;
        
        // Simple heuristics for follow-up detection
        const followUpIndicators = [
            'what about', 'and also', 'additionally', 'furthermore', 'also', 
            'too', 'as well', 'tell me more', 'explain further', 'continue',
            'go on', 'elaborate', 'more details', 'can you clarify'
        ];
        
        // Check for pronouns that might indicate continuation
        const pronouns = ['it', 'this', 'that', 'these', 'those', 'they', 'them', 'their'];
        
        // Check if message contains any indicators
        const containsIndicator = followUpIndicators.some(indicator => 
            message.toLowerCase().includes(indicator.toLowerCase())
        );
        
        // Check for standalone pronouns that likely refer to previous context
        const startsWithPronoun = pronouns.some(pronoun => {
            const pattern = new RegExp(`^${pronoun}\\b`, 'i');
            return pattern.test(message.trim());
        });
        
        // Check for short queries that are likely follow-ups
        const isShortQuery = message.split(' ').length <= 4;
        
        // Consider it a follow-up if any condition is true
        return containsIndicator || startsWithPronoun || isShortQuery;
    }

    // Message classification - determines how to process the message
    async classifyMessage(message, persona, isFollowUp = false) {
        // Get persona configuration
        const personaConfig = llmModule.personasConfig[persona] || {};
        
        // Check for explicit triggers (for backward compatibility)
        if (message.startsWith('/ai')) {
            return {
                type: 'direct_llm',
                needsRAG: false,
                needsTools: false,
                processedMessage: message.slice(3).trim()
            };
        }
        
        if (message.startsWith('/rag')) {
            return {
                type: 'direct_rag',
                needsRAG: true,
                needsTools: false,
                processedMessage: message.slice(4).trim()
            };
        }
        
        // Determine capabilities based on persona configuration
        const hasRagCapability = personaConfig.collection && personaConfig.collection.length > 0;
        const hasToolsCapability = personaConfig.tools && personaConfig.tools.length > 0;
        
        // If this is a follow-up query and previous query used RAG, continue using RAG
        if (isFollowUp) {
            return {
                type: 'follow_up',
                needsRAG: hasRagCapability,
                needsTools: hasToolsCapability,
                processedMessage: message
            };
        }
        
        // Check for knowledge-intensive query patterns
        const knowledgePatterns = [
            'what is', 'how do', 'explain', 'define', 'describe', 
            'tell me about', 'information on', 'details about',
            'who is', 'when did', 'where is', 'why does'
        ];
        
        const isKnowledgeQuery = knowledgePatterns.some(pattern => 
            message.toLowerCase().includes(pattern.toLowerCase())
        );
        
        // Check for action-oriented query patterns
        const actionPatterns = [
            'can you', 'please', 'help me', 'i need', 'i want',
            'update', 'change', 'add', 'remove', 'create',
            'check', 'track', 'find', 'fetch', 'get me', 'show me'
        ];
        
        const isActionQuery = actionPatterns.some(pattern => 
            message.toLowerCase().includes(pattern.toLowerCase())
        );
        
        // Determine the message type based on the analysis
        if (isKnowledgeQuery && hasRagCapability && isActionQuery && hasToolsCapability) {
            return {
                type: 'hybrid_query',
                needsRAG: true,
                needsTools: true,
                processedMessage: message
            };
        } else if (isKnowledgeQuery && hasRagCapability) {
            return {
                type: 'knowledge_query', 
                needsRAG: true,
                needsTools: false,
                processedMessage: message
            };
        } else if (isActionQuery && hasToolsCapability) {
            return {
                type: 'action_query',
                needsRAG: false,
                needsTools: true,
                processedMessage: message
            };
        } else {
            return {
                type: 'simple_query',
                needsRAG: false,
                needsTools: false,
                processedMessage: message
            };
        }
    }
}

module.exports = MessageRouter;