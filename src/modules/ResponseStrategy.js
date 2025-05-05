// ResponseStrategy.js - Implements different strategies for generating responses
// This is the core component that decides how to process different types of queries

const llmModule = require('./llmModule');
const { handleRAG } = require('./ragHandler1');
const { createToolCallingAgent, AgentExecutor } = require("langchain/agents");
const { customerSupportTools } = require("./customerSupportModule.js");
const buildPersonaPrompt  = require('./buildPersonaPrompt');
const { ChatPromptTemplate } = require('@langchain/core/prompts');

const defaultPersona = process.env.DEFAULT_PERSONA || 'helpfulAssistant';
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
    async generateResponse({ sessionId, message, queryType, persona, recipientId, groupName, classification, isImprovement = false }) {
        console.log(`[ResponseStrategy] Generating ${queryType} response, improvement: ${isImprovement}`);

        // queryType = this.determineQueryType(persona, context);
        // Fix logging to ensure the correct persona is shown
        console.log(`[ResponseStrategy1] Generating ${queryType} response for ${sessionId} using persona ${persona}`);
        
        if (!message || typeof message !== 'string') {
            console.error(`[ResponseStrategy] Invalid message: ${typeof message}`);
            return "I'm sorry, I couldn't process your request. Please try again.";
        }
        
        try {
            // Check cache first
            const cachedResult = this.cache.get(sessionId, queryType, message);
            if (cachedResult) {
                console.log(`[ResponseStrategy2] Using cached result for ${queryType} query`);
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
            console.log(`[ResponseStrategy3] Generated response: ${response}`);
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
        console.log(`[ResponseStrategy1] Processing RAG query for ${persona}`);
        let model = null; // Initialize
        try {
            // Check if persona has RAG capability
            const { hasRagCapability, config } = checkPersonaCapabilities(persona);
            
            if (!hasRagCapability) {
                console.log(`[ResponseStrategy] No RAG capability for ${persona}, falling back to simple query`);
                return this.handleSimpleQuery({ sessionId, message, persona });
            }
            if(config.model){
                console.log(`[ResponseStrategy] Using custom model for ${persona}: ${config.model}`);
                // Set the model for the LLM instance        
                model = config.model;       
            }
            
            // Pass the query to RAG handler
            const ragResponse = await handleRAG(message, sessionId, persona, model);
            return ragResponse.text || ragResponse;
        } catch (error) {
            console.error('[ResponseStrategy] RAG query error:', error);
            
            // Fallback to simple query if RAG fails
            return this.handleSimpleQuery({ sessionId, message, persona });
        }
    }
    
// Improved handleActionQuery method that maintains flexibility
// Enhanced handleActionQuery method with better LangChain agent configuration
async handleActionQuery({ sessionId, message, persona }) {
    console.log(`[ResponseStrategy3] Processing action query for ${persona}`);
    let llm = null; 
    try {
        // Check if persona has tools capability
        const { config: personaConfig, hasToolsCapability } = checkPersonaCapabilities(persona);
        
        if (!hasToolsCapability) {
            console.log(`[ResponseStrategy] No tools available for ${persona}, falling back to simple query`);
            return this.handleSimpleQuery({ sessionId, message, persona });
        }
        
        // Get allowed tools for this persona
        let allowedToolNames = personaConfig.tools || [];
        
        // Handle different formats of the tools field
        if (typeof allowedToolNames === 'string') {
            // Handle comma-separated string format
            allowedToolNames = allowedToolNames
              .split(',')
              .map(name => name.trim())
              .filter(name => name.length > 0);
        } else if (Array.isArray(allowedToolNames) && allowedToolNames.length > 0 && typeof allowedToolNames[0] === 'object') {
            // Handle array of objects format from persona config
            allowedToolNames = allowedToolNames.map(tool => tool.name);
        }
        
        console.log(`[ResponseStrategy] Allowed tools for ${persona}: ${JSON.stringify(allowedToolNames)}`);
        
        // Filter available tools based on persona permissions
        const toolsToAttach = customerSupportTools.filter((tool) => 
            allowedToolNames.includes(tool.name)
        );
        console.log("Attaching these tool instances:", toolsToAttach.map((t) => t.name));
        
        // Check if persona has model capability
        if (personaConfig.model) {
            console.log(`[ResponseStrategy] Using custom model for ${persona}: ${personaConfig.model}`);
            // Here's the key change - enhance the LLM configuration for better tool calling
            llm = await llmModule.getLLMInstance(personaConfig.model, {
                // Add model-specific parameters that encourage tool usage
                temperature: 0.2,  // Lower temperature for more deterministic tool calling
                responseFormat: { type: "json_object" },  // Many models work better with JSON
                toolChoice: "auto"  // Explicitly enable automatic tool choice
            });
        } else {
            // Use default model with tool-friendly configuration
            llm = await llmModule.getLLMInstance(null, {
                temperature: 0.2,
                responseFormat: { type: "json_object" },
                toolChoice: "auto"
            });
        }

        // If no tools available after filtering, fall back to simple query
        if (!toolsToAttach || toolsToAttach.length === 0) {
            console.log(`[ResponseStrategy] No tools available for ${persona} after filtering, falling back to simple query`);
            return this.handleSimpleQuery({ sessionId, message, persona });
        }
        
        // Extract the tool descriptions for better agent awareness
        const toolDescriptions = toolsToAttach.map(tool => 
            `${tool.name}: ${tool.description}`
        ).join('\n');
        
        // Build persona prompt
        const personaPrompt = await buildPersonaPrompt(persona, sessionId);
        
        // Create a context-aware system message that respects the persona
        const systemMessage = `You are a ${personaConfig.description || 'helpful assistant'}.

${personaConfig.behaviorInstructions || ''}

You have access to these tools:
${toolDescriptions}

${personaConfig.functionalDirectives || ''}
${personaConfig.ethicalGuidelines || ''}`;

        // Create a more sophisticated agent
        // Consider using createOpenAIFunctionsAgent instead if compatible with your model
        const agent = await createToolCallingAgent({
            llm,
            tools: toolsToAttach,
            prompt: ChatPromptTemplate.fromMessages([
                ["system", systemMessage],
                ["user", "{input}"],
                ["placeholder", "{agent_scratchpad}"]
            ])
        });
        
        // Configure the agent executor with optimized settings
        const agentExecutor = new AgentExecutor({
            agent,
            tools: toolsToAttach,
            // These settings are crucial for effective tool calling
            maxIterations: 4,
            returnIntermediateSteps: true,
            handleParsingErrors: true, // Handle parsing errors gracefully
            earlyStoppingMethod: "generate", // Continue generating even if a stopping condition is met
        });
        
        // Enhance message with persona context
        const enhancedMessage = personaPrompt 
            ? `${personaPrompt}\n\nUser request: ${message}`
            : message;
            
        console.log(`[ResponseStrategy4] Enhanced message for action query: ${enhancedMessage}`);
        
        // Add tool-calling debug log
        console.log(`[ResponseStrategy] Starting tool agent with ${toolsToAttach.length} tools for query: ${message}`);
        
        // Execute agent with tools and capture full result including steps
        const result = await agentExecutor.invoke({
            input: enhancedMessage,
            // Add any additional context that might help with tool selection
            sessionId,
            allowToolUse: true  // Explicit flag to allow tool usage
        });
        
        // Log the actual tools used for debugging
        if (result.intermediateSteps && result.intermediateSteps.length > 0) {
            const toolsUsed = result.intermediateSteps
                .filter(step => step.action && step.action.tool)
                .map(step => step.action.tool);
                
            console.log(`[ResponseStrategy] Tools used: ${toolsUsed.join(', ') || 'None'}`);
        } else {
            console.log(`[ResponseStrategy] Warning: No tools were used in response generation`);
        }

        return result.output;
    } catch (error) {
        console.error('[ResponseStrategy] Action query error:', error);
        
        // Log additional details about the error for better debugging
        if (error.message.includes('tool')) {
            console.error('[ResponseStrategy] Possible tool calling error:', error.message);
        }
        
        // Fallback to simple query if tool execution fails
        return this.handleSimpleQuery({ sessionId, message, persona });
    }
}
    
    // Strategy 4: Hybrid query - RAG + tools
    async handleHybridQuery({ sessionId, message, persona, context }) {
        console.log(`[ResponseStrategy] Processing hybrid query for ${persona}`);
        let llm = null; // Initialize
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
            if (personaConfig.model) {
                console.log(`[ResponseStrategy] Using custom model for ${persona}: ${personaConfig.model}`);
                // Set the model for the LLM instance                
                llm = await llmModule.getLLMInstance(personaConfig.model);
            } else {
                // Use default model if not specified
                llm = await llmModule.getLLMInstance();
            }

            const agent = await createToolCallingAgent({ 
                llm, 
                tools: toolsToAttach,
                prompt: ChatPromptTemplate.fromMessages([
                    ["system", `You are a helpful customer service assistant. Use the provided tools to help answer the customer's question directly. Do not just describe what the tools do - use them to get information and then answer the question with that information. When a customer asks about their orders, use the fetch_customer_last_orders or summarize_last_orders tools to get the actual information before answering.`],
                    ["user", "{input}"],
                    ["placeholder", "{agent_scratchpad}"],
                ])
            });
            const agentExecutor = new AgentExecutor({ agent, tools: toolsToAttach });
            
            // Step 4: Build enhanced prompt with persona, RAG context, and user query
            const personaPrompt = await buildPersonaPrompt(persona,sessionId);
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