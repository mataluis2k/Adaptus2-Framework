// ResponseStrategy.js - Implements different strategies for generating responses
// This is the core component that decides how to process different types of queries

const llmModule = require('./llmModule');
const { handleRAG } = require('./ragHandler1');
const { createToolCallingAgent, AgentExecutor } = require("langchain/agents");
const { customerSupportTools } = require("./customerSupportModule.js");
const buildPersonaPrompt  = require('./buildPersonaPrompt');
// Cache for storing recent query results
class ResponseCache {
    constructor(maxSize = 100, ttlMs = 3600000) { // Default 1 hour TTL
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }
    
    generateKey(sessionId, queryType, query) {
        // Add safety checks for parameters
        if (!sessionId) sessionId = 'default';
        if (!queryType) queryType = 'unknown';
        if (!query || typeof query !== 'string') query = '';
        
        // Create a simplified version of the query for fuzzy matching
        const simplifiedQuery = query.toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .split(/\s+/)  // Split into words
            .filter(word => word.length > 3)  // Keep only significant words
            .sort()  // Sort for better matching
            .join('_');  // Join back
            
        return `${sessionId}:${queryType}:${simplifiedQuery}`;
    }
    
    get(sessionId, queryType, query) {
        // Add safety checks for parameters
        if (!sessionId || !queryType || !query) {
            console.log(`[ResponseCache] Missing required parameters: sessionId=${sessionId}, queryType=${queryType}, query=${typeof query}`);
            return null;
        }
        
        try {
            const key = this.generateKey(sessionId, queryType, query);
            const cached = this.cache.get(key);
            
            if (!cached) return null;
            
            // Check if cached result has expired
            if (Date.now() - cached.timestamp > this.ttlMs) {
                this.cache.delete(key);
                return null;
            }
            
            // Update timestamp to extend TTL on access
            cached.timestamp = Date.now();
            return cached.data;
        } catch (error) {
            console.error(`[ResponseCache] Error getting from cache: ${error.message}`);
            return null;
        }
    }
    
    set(sessionId, queryType, query, data) {
        // Add safety checks for parameters
        if (!sessionId || !queryType || !query || !data) {
            console.log(`[ResponseCache] Missing required parameters for cache set`);
            return;
        }
        
        try {
            const key = this.generateKey(sessionId, queryType, query);
            
            // Add to cache with timestamp
            this.cache.set(key, {
                data,
                timestamp: Date.now()
            });
            
            // Maintain cache size limit
            if (this.cache.size > this.maxSize) {
                // Remove oldest entry
                const oldestKey = [...this.cache.entries()]
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
                this.cache.delete(oldestKey);
            }
        } catch (error) {
            console.error(`[ResponseCache] Error setting cache: ${error.message}`);
        }
    }
    
    clear(sessionId = null) {
        if (sessionId) {
            // Clear only entries for this session
            for (const key of this.cache.keys()) {
                if (key.startsWith(`${sessionId}:`)) {
                    this.cache.delete(key);
                }
            }
        } else {
            // Clear entire cache
            this.cache.clear();
        }
    }
}
function checkPersonaCapabilities(persona) {
    const personaConfig = llmModule.personasConfig[persona] || {};
    return {
        config: personaConfig,
        hasRagCapability: personaConfig.collection && personaConfig.collection.length > 0,
        hasToolsCapability: personaConfig.tools && personaConfig.tools.length > 0
    };
}
class ResponseStrategy {
    constructor() {
        this.cache = new ResponseCache();
    }
    /**
 * Determines the appropriate query type based on persona capabilities
 * @param {string} persona - The persona name
 * @param {Object} context - Optional context from previous interactions
 * @returns {string} - The appropriate query type
 */
determineQueryType(persona, context = null) {
    console.log(`[ResponseStrategy] Determining query type for persona: ${persona}`);
    
    // Get persona configuration
    const personaConfig = llmModule.personasConfig[persona] || {};
    
    // Check persona capabilities
    const hasRagCapability = personaConfig.collection && personaConfig.collection.length > 0;
    const hasToolsCapability = personaConfig.tools && personaConfig.tools.length > 0;
    
    // If context is available, consider it a follow-up query
    if (context) {
        return 'follow_up';
    }
    
    // If both RAG and tools are available, use hybrid
    if (hasRagCapability && hasToolsCapability) {
        return 'hybrid_query';
    }
    // If only RAG is available, use direct_rag
    else if (hasRagCapability) {
        return 'direct_rag';
    }
    // If only tools are available, use action_query
    else if (hasToolsCapability) {
        return 'action_query';
    }
    // Fall back to simple query if no special capabilities
    else {
        return 'simple_query';
    }
}
    // Main method to generate responses based on strategy
    async generateResponse(params) {
        // Validate parameters and set defaults
        if (!params) params = {};
        let {
            sessionId = 'default',
            message = '',
            queryType = 'simple_query',
            persona = 'default',
            context = null,
            recipientId = null, // Added to match parameter from MessageRouter
            groupName = null    // Added to match parameter from MessageRouter
        } = params;
        
        // Determine query type if not specified
        queryType = this.determineQueryType(persona, context);
        // Fix logging to ensure the correct persona is shown
        console.log(`[ResponseStrategy] Generating ${queryType} response for ${sessionId} using persona ${persona}`);
        
        if (!message || typeof message !== 'string') {
            console.error(`[ResponseStrategy] Invalid message: ${typeof message}`);
            return "I'm sorry, I couldn't process your request. Please try again.";
        }
        
        try {
            // Check cache first
            const cachedResult = this.cache.get(sessionId, queryType, message);
            if (cachedResult) {
                console.log(`[ResponseStrategy] Using cached result for ${queryType} query`);
                return cachedResult;
            }
            
            // Based on query type, delegate to appropriate strategy
            let response;
            
            switch (queryType) {
                case 'direct_llm':
                    response = await this.handleSimpleQuery({ sessionId, message, persona });
                    break;
                    
                case 'direct_rag':
                    response = await this.handleRagQuery({ sessionId, message, persona });
                    break;
                    
                case 'hybrid_query':
                    response = await this.handleHybridQuery({ sessionId, message, persona, context });
                    break;
                    
                case 'knowledge_query':
                    response = await this.handleKnowledgeQuery({ sessionId, message, persona });
                    break;
                    
                case 'action_query':
                    response = await this.handleActionQuery({ sessionId, message, persona });
                    break;
                    
                case 'follow_up':
                    response = await this.handleFollowUpQuery({ sessionId, message, persona, context });
                    break;
                    
                case 'simple_query':
                default:
                    response = await this.handleSimpleQuery({ sessionId, message, persona });
                    break;
            }
            
            // Cache result if appropriate (don't cache error responses)
            if (response && !response.includes("I apologize") && !response.includes("Error")) {
                this.cache.set(sessionId, queryType, message, response);
            }
            
            return response;
        } catch (error) {
            console.error('[ResponseStrategy] Error generating response:', error);
            return `I apologize, but I encountered an error while processing your request. Please try again.`;
        }
    }
    
    // Strategy 1: Simple LLM query without RAG or tools
    async handleSimpleQuery({ sessionId, message, persona }) {
        console.log(`[ResponseStrategy] Processing simple query for ${persona}`);
        
        try {
            // Build persona prompt
            const personaPrompt = await buildPersonaPrompt(persona, sessionId);
            
            // Combine persona instructions with user message
            const enhancedMessage = personaPrompt 
                ? `${personaPrompt}\n\nUser message: ${message}`
                : message;
                
            // Create message object for LLM
            const messageData = {
                senderId: sessionId,
                recipientId: 'AI_Assistant',
                message: enhancedMessage,
                timestamp: new Date().toISOString(),
                status: 'processing'
            };
            
            // Call LLM
            const response = await llmModule.callLLM(messageData);
            return response.message;
        } catch (error) {
            console.error('[ResponseStrategy] Simple query error:', error);
            return "I apologize, but I encountered an error while processing your request. Please try again.";
        }
    }
    
    // Strategy 2: RAG query - knowledge retrieval
    async handleRagQuery({ sessionId, message, persona }) {
        console.log(`[ResponseStrategy] Processing RAG query for ${persona}`);
        
        try {
            // Check if persona has RAG capability
            const { hasRagCapability } = checkPersonaCapabilities(persona);
            
            if (!hasRagCapability) {
                console.log(`[ResponseStrategy] No RAG capability for ${persona}, falling back to simple query`);
                return this.handleSimpleQuery({ sessionId, message, persona });
            }
            
            // Pass the query to RAG handler
            const ragResponse = await handleRAG(message, sessionId, persona);
            return ragResponse.text || ragResponse;
        } catch (error) {
            console.error('[ResponseStrategy] RAG query error:', error);
            
            // Fallback to simple query if RAG fails
            return this.handleSimpleQuery({ sessionId, message, persona });
        }
    }
    
    // Strategy 3: Action query - using tools
    async handleActionQuery({ sessionId, message, persona }) {
        console.log(`[ResponseStrategy] Processing action query for ${persona}`);
        
        try {
            // Check if persona has tools capability
            const { config: personaConfig, hasToolsCapability } = checkPersonaCapabilities(persona);
            
            if (!hasToolsCapability) {
                console.log(`[ResponseStrategy] No tools available for ${persona}, falling back to simple query`);
                return this.handleSimpleQuery({ sessionId, message, persona });
            }
            
            // Get allowed tools for this persona
            const allowedToolNames = personaConfig.tools || [];
            
            // Filter available tools based on persona permissions
            const toolsToAttach = customerSupportTools.filter(tool => 
                allowedToolNames.includes(tool.name)
            );
            
            // If no tools available after filtering, fall back to simple query
            if (!toolsToAttach || toolsToAttach.length === 0) {
                console.log(`[ResponseStrategy] No tools available for ${persona} after filtering, falling back to simple query`);
                return this.handleSimpleQuery({ sessionId, message, persona });
            }
            
            // Get LLM instance
            const llm = await llmModule.getLLMInstance();
            
            // Create tool calling agent
            const agent = await createToolCallingAgent({ llm, tools: toolsToAttach });
            const agentExecutor = new AgentExecutor({ agent, tools: toolsToAttach });
            
            // Build persona prompt
            const personaPrompt = await buildPersonaPrompt(persona);
            
            // Enhance message with persona context
            const enhancedMessage = personaPrompt 
                ? `${personaPrompt}\n\nUser request: ${message}`
                : message;
                
            // Execute agent with tools
            const result = await agentExecutor.invoke({ input: enhancedMessage });
            return result.output;
        } catch (error) {
            console.error('[ResponseStrategy] Action query error:', error);
            
            // Fallback to simple query if tool execution fails
            return this.handleSimpleQuery({ sessionId, message, persona });
        }
    }
    
    // Strategy 4: Hybrid query - RAG + tools
    async handleHybridQuery({ sessionId, message, persona, context }) {
        console.log(`[ResponseStrategy] Processing hybrid query for ${persona}`);
        
        try {
            // Check persona capabilities
            const { config: personaConfig, hasRagCapability, hasToolsCapability } = checkPersonaCapabilities(persona);
            
            // If no RAG capability, fall back to tools only (action query)
            if (!hasRagCapability) {
                console.log(`[ResponseStrategy] No RAG capability for hybrid query, using action query`);
                return this.handleActionQuery({ sessionId, message, persona });
            }
            
            // Step 1: Get knowledge context with RAG
            let contextInfo;
            if (context) {
                // Use provided context if available
                contextInfo = context;
            } else {
                // Otherwise, fetch it with RAG
                const ragResponse = await handleRAG(message, sessionId, persona);
                contextInfo = ragResponse.text || ragResponse;
            }
            
            // If no tools capability, just return the RAG response
            if (!hasToolsCapability) {
                console.log(`[ResponseStrategy] No tools capability for hybrid query, using RAG response`);
                return contextInfo;
            }
            
            // Step 2: Get tools for this persona
            const allowedToolNames = personaConfig.tools || [];
            const toolsToAttach = customerSupportTools.filter(tool => 
                allowedToolNames.includes(tool.name)
            );
            
            // If no tools available after filtering, just return the RAG response
            if (!toolsToAttach || toolsToAttach.length === 0) {
                console.log(`[ResponseStrategy] No tools after filtering for hybrid query, using RAG response`);
                return contextInfo;
            }
            
            // Step 3: Create agent with tools
            const llm = await llmModule.getLLMInstance();
            const agent = await createToolCallingAgent({ llm, tools: toolsToAttach });
            const agentExecutor = new AgentExecutor({ agent, tools: toolsToAttach });
            
            // Step 4: Build enhanced prompt with persona, RAG context, and user query
            const personaPrompt = await buildPersonaPrompt(persona);
            const enhancedMessage = `
                ${personaPrompt || ''}
                
                Relevant context information:
                ${contextInfo}
                
                Based on this context, please address the following user request:
                ${message}
                
                Use the tools available to you when appropriate to fulfill the request.
            `;
            
            // Step 5: Execute agent
            const result = await agentExecutor.invoke({ input: enhancedMessage });
            return result.output;
        } catch (error) {
            console.error('[ResponseStrategy] Hybrid query error:', error);
            
            // Try fallback to RAG-only if hybrid approach fails
            try {
                return await this.handleRagQuery({ sessionId, message, persona });
            } catch (fallbackError) {
                // Final fallback to simple query
                return this.handleSimpleQuery({ sessionId, message, persona });
            }
        }
    }
    
    // Strategy 5: Follow-up query - maintain context
    async handleFollowUpQuery({ sessionId, message, persona, context }) {
        console.log(`[ResponseStrategy] Processing follow-up query for ${persona}`);
        
        // Check persona capabilities
        const { hasRagCapability, hasToolsCapability } = checkPersonaCapabilities(persona);
        
        // If context is available and both RAG and tools are available, use hybrid
        if (context && hasRagCapability && hasToolsCapability) {
            return this.handleHybridQuery({ 
                sessionId, 
                message, 
                persona,
                context 
            });
        } 
        // If context is available and RAG is available, use knowledge query
        else if (context && hasRagCapability) {
            // For follow-ups to RAG queries, we need special handling
            // We'll add the follow-up to the previous context
            const enhancedMessage = `
                Previous context: ${context}
                
                Follow-up question: ${message}
                
                Please answer the follow-up question based on the previous context.
            `;
            
            return this.handleRagQuery({ 
                sessionId, 
                message: enhancedMessage, 
                persona 
            });
        } 
        // If tools are available, try action query
        else if (hasToolsCapability) {
            return this.handleActionQuery({ sessionId, message, persona });
        } 
        // Fallback to simple query
        else {
            return this.handleSimpleQuery({ sessionId, message, persona });
        }
    }
    
    // Strategy 6: Knowledge query - RAG without tools
    async handleKnowledgeQuery({ sessionId, message, persona }) {
        // This is essentially the same as RAG query
        return this.handleRagQuery({ sessionId, message, persona });
    }
}

module.exports = ResponseStrategy;