// MessageRouter.js - Responsible for message routing, analysis and processing decisions
// Coordinates with various components to determine optimal processing paths
// Part of the optimized chat architecture design

const llmModule = require('./llmModule');
const customerSupportModule = require('./customerSupportModule');

class MessageRouter {
    constructor(responseEngine) {
        this.responseEngine = responseEngine;
        this.recentQueries = new Map(); // Store recent queries by session for context
        this.maxRecentQueries = 5; // Number of recent queries to keep per session
        this.defaultPersona = process.env.DEFAULT_PERSONA || 'helpfulAssistant'; // Default persona if none is detected
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
    async routeMessage(sessionId, message, recipientId, groupName = null, userId = null) {
        console.log(`[MessageRouter] Routing message from ${sessionId}`);
        
        if (!sessionId || !message) {
            console.error('[MessageRouter] Missing required parameters: sessionId or message');
            return {
                response: "I apologize, but I encountered an error processing your request.",
                persona: this.defaultPersona,
                classification: { type: "error" }
            };
        }
        
        try {
            // // Step 1: Detect persona from message
            
            // const PersonaResult = await llmModule.detectRequestedPersona(message);
            // console.log(`[MessageRouter1] Detected persona: ` +  JSON.stringify(PersonaResult));
            // const { requestedPersona, cleanedMessage } = PersonaResult;
            
            // Step 2: If no specific persona detected, select best one for this message

            const userContext = await customerSupportModule.buildCustomerProfile(userId);
            console.log(`[MessageRouter2] Routing message with userContext `,JSON.stringify(userContext));
            let selectedPersona = "";
            const personas = llmModule.getPersonasWithDescriptions();
            console.log(`[MessageRouter2] Available personas:`, JSON.stringify(personas));
            const personaResult = await llmModule.selectPersona(
                message, 
                personas, 
                { userContext: userContext, sessionId: sessionId }
            );
            if (personaResult.directAnswer) {
                console.log(`[MessageRouter] Providing direct answer from context information`);
                return {
                    response: personaResult.directAnswer,
                    persona: null, // No persona was used
                    classification: {
                        needsRAG: false,
                        needsTools: false,
                        isDirect: true
                    }
                };
            }
            selectedPersona = personaResult.persona;
            // Safety check - ensure we have a valid persona
            if (!selectedPersona) {
                console.log('[MessageRouter] No persona selected, using default');
                selectedPersona = this.defaultPersona;
            }
            
            console.log(`[MessageRouter2] Selected persona:`,JSON.stringify(selectedPersona));
            
            // Step 3: Analyze message for context continuation
            // Since we're no longer using persona detection, just use the original message
            const processedMessage = message;
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
        console.log(`[MessageRouter3] Persona config: ${JSON.stringify(personaConfig)}`);
        
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
        }  else if (hasRagCapability) {
            return {
                type: 'direct_rag', 
                needsRAG: true,
                needsTools: false,
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