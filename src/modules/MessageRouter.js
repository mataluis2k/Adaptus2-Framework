/**
 * Enhanced MessageRouter that uses the GlobalToolRegistry
 * for tool execution and persona management
 */

const llmModule = require('./llmModule');
const customerSupportModule = require('./customerSupportModule');
const buildPersonaPrompt = require('./buildPersonaPrompt');
const toolRegistry = require('./GlobalToolRegistry');

class MessageRouter {
    constructor(responseEngine) {
        this.responseEngine = responseEngine;
        this.recentQueries = new Map(); // Store recent queries by session for context
        this.maxRecentQueries = 5; // Number of recent queries to keep per session
        this.defaultPersona = process.env.DEFAULT_PERSONA || 'helpfulAssistant'; // Default persona if none is detected
        this.personasConfig = {}; // Load personas configuration
        this.initialize().catch(err => {
            console.error('[MessageRouter] Initialization error:', err);
        });
    }   

    async initialize() {
        // Load personas configuration
        this.personasConfig = llmModule.personasConfig;
        const personaCount = Object.keys(this.personasConfig).length;
        console.log(`[MessageRouter] Loaded personas configuration: ${personaCount} personas`);
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

    // Main routing function - now with tool-assisted response flow and GlobalToolRegistry
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
            // Step 1: First detect if there's an explicit persona requested in the message
            const personaResult = await llmModule.detectRequestedPersona(message);
            console.log(`[MessageRouter] Detected persona: ${JSON.stringify(personaResult)}`);
            
            let selectedPersona = null;
            let processedMessage = message;
            let recommendedTool = null;
            let routingReason = null;
            
            // Step 2: If a persona was explicitly requested, use it
            if (personaResult.requestedPersona) {
                selectedPersona = personaResult.requestedPersona;
                processedMessage = personaResult.cleanedMessage || message;
                routingReason = `Explicitly requested by user (${personaResult.method || 'direct request'})`;
                console.log(`[MessageRouter] Using explicitly requested persona: ${JSON.stringify(selectedPersona)}`);
            } 
            // Step 3: If no persona was explicitly requested, use enhanced selection 
            else {
                // Build user context for better persona selection
                const userContext = await customerSupportModule.buildCustomerProfile(userId);
                console.log(`[MessageRouter] Built user context for persona selection`);
                
                // Get personas with descriptions for selectPersona
                const personas = llmModule.getPersonasWithDescriptions();
                console.log(`[MessageRouter] Available personas: ${personas.length}`);
                
                // Use enhanced persona selection with comprehensive information
                const selectionResult = await llmModule.selectPersona(
                    message, 
                    personas, 
                    { userContext: userContext, sessionId: sessionId }
                );
                
                // Handle direct answers from context
                if (selectionResult.directAnswer) {
                    console.log(`[MessageRouter] Providing direct answer from context. Reason: ${selectionResult.reason || 'Not specified'}`);
                    return {
                        response: selectionResult.directAnswer,
                        persona: null, // No persona was used
                        classification: {
                            needsRAG: false,
                            needsTools: false,
                            isDirect: true
                        },
                        routingReason: selectionResult.reason || 'Direct answer from context'
                    };
                }
                
                selectedPersona = selectionResult.persona;
                recommendedTool = selectionResult.recommendedTool || null;
                routingReason = selectionResult.reason || 'Selected based on message content';
                console.log(`[MessageRouter] Selected persona based on content: ${selectedPersona}`);
                
                if (recommendedTool) {
                    console.log(`[MessageRouter] Recommended tool: ${recommendedTool}`);
                }
            }
            
            // Safety check - ensure we have a valid persona
            if (!selectedPersona) {
                console.log('[MessageRouter] No persona selected, using default');
                selectedPersona = this.defaultPersona;
                routingReason = 'Fallback to default persona';
            }
            
            console.log(`[MessageRouter] Final selected persona: ${JSON.stringify(selectedPersona)}, reason: ${routingReason}`);
            
            // Step 4: NEW FLOW - If we have a recommended tool, use the tool-assisted response flow
            if (recommendedTool) {
                console.log(`[MessageRouter] Attempting tool-assisted response flow with ${recommendedTool}`);
                
                // Verify the persona has access to this tool using the registry
                const hasToolAccess = toolRegistry.isToolAllowedForPersona(
                    selectedPersona, 
                    recommendedTool, 
                    this.personasConfig
                );
                
                if (hasToolAccess) {
                    // Get the tool from the registry
                    const tool = toolRegistry.getTool(recommendedTool);
                    
                    if (tool) {
                        // Try the tool-assisted response flow
                        const toolAssistedResponse = await this.handleToolAssistedResponse(
                            processedMessage, 
                            selectedPersona, 
                            recommendedTool, 
                            sessionId, 
                            userId, 
                            recipientId, 
                            groupName
                        );
                        
                        // If we got a valid tool-assisted response, return it directly
                        if (toolAssistedResponse) {
                            // Record the query for future context
                            this.recordQuery(sessionId, processedMessage, toolAssistedResponse.classification);
                            
                            return toolAssistedResponse;
                        }
                    }
                    
                    // If tool-assisted flow failed, log and continue with standard flow
                    console.log(`[MessageRouter] Tool-assisted flow failed or returned null, falling back to standard flow`);
                }
            }
            
            // Step 5: Standard flow - Analyze message for context continuation
            const recentQueries = this.getRecentQueries(sessionId);
            
            // Check if this is a follow-up to a recent RAG query
            const isFollowUp = this.isFollowUpQuery(processedMessage, recentQueries);
            
            // Step 6: Classify the message
            const classification = await this.classifyMessage(
                processedMessage, 
                selectedPersona, 
                isFollowUp,
                recommendedTool
            );
            
            // Step 7: Record this query for future context
            this.recordQuery(sessionId, processedMessage, classification);
            
            // Step 8: Get response using the appropriate strategy
            const response = await this.responseEngine.generateResponse({
                sessionId,
                message: processedMessage,
                queryType: classification.type,
                persona: selectedPersona,
                recommendedTool: recommendedTool,
                context: null,  // Context could be added here if available
                recipientId,
                groupName
            });
            
            return {
                response,
                persona: selectedPersona,
                classification,
                routingReason
            };
            
        } catch (error) {
            console.error('[MessageRouter] Error routing message:', error);
            
            // Fallback to simple response
            return {
                response: "I apologize, but I encountered an error processing your request. Please try again.",
                persona: "default",
                classification: { type: "error" },
                routingReason: `Error in routing: ${error.message}`
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

    // Enhanced message classification - determines how to process the message
    // Now includes support for recommended tools
    async classifyMessage(message, persona, isFollowUp = false, recommendedTool = null) {
        // Get persona configuration
        const personaConfig = this.personasConfig[persona] || {};
        console.log(`[MessageRouter_CM] Number of Personas: ${personaConfig.length}`);
        console.log(`[MessageRouter] Persona config: ${JSON.stringify(personaConfig)}`);
        
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
        
        // Determine capabilities based on persona configuration and tool registry
        const hasRagCapability = personaConfig.collection && personaConfig.collection.length > 0;
        
        // Use tool registry to check if persona has any tools available
        const personaTools = toolRegistry.getToolsForPersona(persona, this.personasConfig);
        const hasToolsCapability = personaTools.length > 0;
        
        // If there's a recommended tool, prioritize using it
        if (recommendedTool && hasToolsCapability) {
            // Verify the persona has this tool using the registry
            const hasToolAccess = toolRegistry.isToolAllowedForPersona(
                persona, 
                recommendedTool, 
                this.personasConfig
            );
            
            if (hasToolAccess) {
                console.log(`[MessageRouter] Using recommended tool: ${recommendedTool}`);
                return {
                    type: 'tool_action',
                    needsRAG: hasRagCapability, // May need RAG for context
                    needsTools: true,
                    recommendedTool: recommendedTool,
                    processedMessage: message
                };
            }
        }
        
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

    // Main tool-assisted response flow handler - now using the tool registry
    async handleToolAssistedResponse(message, persona, toolName, sessionId, userId, recipientId, groupName) {
        console.log(`[MessageRouter] Executing tool-assisted response with ${toolName} for ${persona}`);
        
        try {
            // Step 1: Get the tool from the registry
            const tool = toolRegistry.getTool(toolName);
            if (!tool) {
                console.warn(`[MessageRouter] Tool ${toolName} not found in registry, falling back to standard response`);
                return null; // Will fall back to standard response flow
            }
            
            // Step 2: Get user context (may be needed for tool execution)
            const userContext = await customerSupportModule.buildCustomerProfile(userId);
            
            // Step 3: Execute the tool with appropriate parameters via the registry
            console.log(`[MessageRouter] Executing tool ${toolName} via registry`);
            
            // Create tool execution params and options
            const executionParams = {
                message,
                sessionId,
                userId,
                userContext
            };
            
            const executionOptions = {
                persona,
                auth: { userId, sessionId } // Basic auth info for tools that need it
            };
            
            // Execute the tool with retry logic via the registry
            const toolResult = await this.executeToolWithRetry(
                toolName,
                executionParams,
                executionOptions
            );
            
            if (!toolResult || toolResult.error) {
                console.warn(`[MessageRouter] Tool execution failed: ${toolResult?.error || 'Unknown error'}`);
                if (toolResult?.recoverable === false) {
                    // If tool explicitly marks error as non-recoverable, return the error
                    return {
                        response: `I tried to use ${toolName} to answer your question, but encountered an error: ${toolResult.error}. Could you try rephrasing your request?`,
                        persona,
                        classification: { 
                            type: 'tool_error',
                            needsTools: true,
                            attemptedTool: toolName,
                            error: toolResult.error
                        },
                        routingReason: `Tool execution failed: ${toolResult.error}`
                    };
                }
                return null; // Will fall back to standard response flow
            }
            
            // Step 4: Generate enhanced response using the tool result
            const enhancedResponse = await this.generateToolEnhancedResponse(
                message,
                persona,
                toolName,
                toolResult,
                sessionId,
                recipientId,
                groupName
            );
            
            if (!enhancedResponse) {
                console.warn(`[MessageRouter] Enhanced response generation failed, falling back to standard response`);
                return null; // Will fall back to standard response flow
            }
            
            // Step 5: Return the enhanced response with appropriate metadata
            return {
                response: enhancedResponse,
                persona,
                classification: { 
                    type: 'tool_assisted',
                    needsTools: true,
                    usedTool: toolName,
                    toolResultIncluded: true
                },
                routingReason: `Generated response using ${toolName} tool results`
            };
        } catch (error) {
            console.error(`[MessageRouter] Error in tool-assisted response flow:`, error);
            return null; // Will fall back to standard response flow
        }
    }

    // Helper method to execute a tool with retry logic
    async executeToolWithRetry(toolName, params, options = {}, maxRetries = 2) {
        let attempts = 0;
        let lastError = null;
        
        while (attempts < maxRetries) {
            try {
                attempts++;
                console.log(`[MessageRouter] Tool execution attempt ${attempts} for ${toolName}`);
                // Use the tool registry to execute the tool
                return await toolRegistry.executeTool(toolName, params, options);
            } catch (error) {
                lastError = error;
                console.warn(`[MessageRouter] Tool execution attempt ${attempts} failed:`, error);
                // If error is explicitly marked as non-recoverable, don't retry
                if (error.recoverable === false) {
                    return {
                        error: error.message,
                        recoverable: false
                    };
                }
                // Brief delay before retry
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        return {
            error: lastError ? lastError.message : 'Tool execution failed after multiple attempts',
            recoverable: true
        };
    }

    // Generate an enhanced response that incorporates the tool results
    async generateToolEnhancedResponse(message, persona, toolName, toolResult, sessionId, recipientId, groupName) {
        try {
            // Get the persona configuration
            const personaConfig = this.personasConfig[persona] || {};
            
            // Create enhanced prompt that includes the tool result
            const toolResultStr = typeof toolResult === 'object' ? 
                JSON.stringify(toolResult, null, 2) : toolResult.toString();
            
            // Get persona prompt if available
            const personaPrompt = typeof buildPersonaPrompt === 'function' ? 
                buildPersonaPrompt(personaConfig) : '';
            
            // Get tool metadata from registry
            const tool = toolRegistry.getTool(toolName) || { description: `Tool: ${toolName}` };
            
            // Build the enhanced prompt
            const enhancedPrompt = `
${personaPrompt ? personaPrompt + '\n\n' : ''}
You are assisting with a query that required using the "${toolName}" tool (${tool.description}). 
The tool has been executed and the results are provided below.
Your task is to create a helpful, natural-sounding response that incorporates the tool results 
to fully answer the user's question.

USER QUERY: ${message}

TOOL USED: ${toolName}

TOOL RESULTS:
${toolResultStr}

Instructions:
1. Use the information from the tool results to directly answer the user's question
2. Provide a complete, helpful response that addresses all aspects of the query
3. If the tool results contain all the information needed, use it completely
4. If the tool results are partial or insufficient, acknowledge this and provide as much information as possible
5. Make your response conversational and helpful, as if you had this knowledge yourself
6. When referring to specific data from the tool results, present it in a clear, organized way
7. Do not tell the user that you used a tool unless it's relevant to explain the source of information

Respond directly to the user, starting your response now:
`;

            // Call LLM with the enhanced prompt
            const enhancedMessageData = {
                senderId: sessionId || 'tool_response_generator',
                recipientId: recipientId || 'user',
                message: enhancedPrompt,
                groupName: groupName,
                timestamp: new Date().toISOString(),
                _personaUsed: persona,
                _toolUsed: toolName,
                status: 'processing'
            };
            
            const response = await llmModule.callLLM(enhancedMessageData);
            
            if (!response || !response.message) {
                console.warn('[MessageRouter] No response from LLM for tool-enhanced prompt');
                return null;
            }
            
            return response.message;
        } catch (error) {
            console.error('[MessageRouter] Error generating tool-enhanced response:', error);
            return null;
        }
    }
}

module.exports = MessageRouter;