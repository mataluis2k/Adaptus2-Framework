// IntelligentChatModule.js
// Main entry point for the enhanced chat system that implements the new architecture
// Maintains compatibility with the existing client interface

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { query } = require("./db"); // Import both getDbConnection and query functions
const llmModule = require("./llmModule");
const { preloadCustomerContext } = require("./customerSupportModule.js");
const MessageRouter = require("./MessageRouter");
const ResponseStrategy = require("./ResponseStrategy");
const buildPersonaPrompt = require('./buildPersonaPrompt');
const toolRegistry = require('./GlobalToolRegistry');
const { handleRAG } = require("./ragHandler1");

// Keep original triggers for backward compatibility
const AI_TRIGGER = "/ai";
const RAG_TRIGGER = "/rag";
const persona = process.env.DEFAULT_PERSONA || "default";

class IntelligentChatModule {
    constructor(httpServer, app, jwtSecret, dbConfig, corsOptions) {
        // Socket.io setup
        this.io = new Server(httpServer, { cors: corsOptions });
        this.jwtSecret = jwtSecret;
        this.connectedUsers = new Map();
        this.rooms = new Map();
        
        // Store database configuration
        this.dbConfig = dbConfig || {
            dbType: process.env.DEFAULT_DBTYPE || 'mysql',
            dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1'
        };
        
        this.app = app;
        
        // Initialize response components
        this.responseStrategy = new ResponseStrategy();
        this.messageRouter = new MessageRouter(this.responseStrategy);
        
        // Session context storage
        this.sessionContexts = new Map();
        
        // Store customer contexts to avoid repeated DB calls
        this.customerContexts = new Map();
        // Add quality control initialization
        this.qualityControlEnabled = process.env.QUALITY_CONTROL_ENABLED === 'true';
        
        // Initialize quality control if global LLM module is available
        if (this.qualityControlEnabled) {
            if (global.llmModule && global.llmModule.qualityControl) {
                this.qualityControl = global.llmModule.qualityControl;
                console.log('[IntelligentChatModule] Quality control initialized from global LLM module');
            } else if (llmModule.qualityControl) {
                this.qualityControl = llmModule.qualityControl;
                console.log('[IntelligentChatModule] Quality control initialized from local LLM module');
            } else {
                console.warn('[IntelligentChatModule] Quality control enabled but not available in LLM module');
                this.qualityControlEnabled = false;
            }
        }
        
        console.log('[IntelligentChatModule] Initialized with intelligent routing');
    }

    async #safePreloadCustomerContext(sessionId, userId, timeoutMs = 3000) {
        if (!sessionId || !userId) {
            console.warn(`[IntelligentChatModule][Preload] Missing sessionId or userId`);
            return;
        }
        
        // Check if we already have context cached for this user
        if (this.customerContexts.has(sessionId)) {
            console.log(`[ChatModule][Preload] ✅ Using cached customer profile for ${sessionId}`);
            
            // If we have a cached context but the conversation might be pruned,
            // ensure the system message is still present in the history
            this.ensureSystemMessagePresent(sessionId);
            
            return;
        }
        
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Preload timeout exceeded')), timeoutMs)
        );
        try {
            await Promise.race([
                preloadCustomerContext(sessionId, userId),
                timeoutPromise
            ]);
            console.log(`[ChatModule][Preload] ✅ Preloaded customer profile for ${sessionId}`);
            
            // Cache the fact that this user now has context loaded
            this.customerContexts.set(sessionId, { 
                userId,
                loadedAt: new Date().toISOString()
            });
        } catch (error) {
            console.warn(`[ChatModule][Preload] ⚠️ Fallback due to: ${error.message}`);
            const fallbackContext = `You are a polite customer support agent. Context preload failed. Answer generally and escalate complex issues to human support.`;
            try {
                // Use global.llmModule if available to prevent circular dependency issues
                if (global.llmModule && global.llmModule.addToHistory) {
                    await global.llmModule.addToHistory(sessionId, fallbackContext, 'system');
                } else if (llmModule.addToHistory) {
                    await llmModule.addToHistory(sessionId, fallbackContext, 'system');
                } else {
                    throw new Error('addToHistory function not available on llmModule');
                }
                
                // Cache the fallback context too
                this.customerContexts.set(sessionId, { 
                    userId,
                    loadedAt: new Date().toISOString(),
                    isFallback: true,
                    fallbackContext // Store the fallback context for potential recovery
                });
            } catch (fallbackError) {
                console.error(`[ChatModule][Preload] ❌ Failed fallback context: ${fallbackError.message}`);
            }
        }
    }
    
    // Ensure system message is present in conversation history
    async ensureSystemMessagePresent(sessionId) {
        try {
            // Get current conversation history from llmModule, trying global.llmModule first
            let history = [];
            if (global.llmModule && global.llmModule.getHistory) {
                history = global.llmModule.getHistory(sessionId);
            } else if (llmModule.getHistory) {
                history = llmModule.getHistory(sessionId);
            } else {
                console.error(`[ChatModule][Preload] Cannot access getHistory function on llmModule`);
                return;
            }
            
            // Check if there's a system message
            const hasSystemMessage = Array.isArray(history) && history.some(msg => msg.role === 'system');
            
            if (!hasSystemMessage && this.customerContexts.has(sessionId)) {
                const contextInfo = this.customerContexts.get(sessionId);
                
                if (contextInfo.isFallback && contextInfo.fallbackContext) {
                    // Reapply the fallback context, using global.llmModule if available
                    if (global.llmModule && global.llmModule.addToHistory) {
                        await global.llmModule.addToHistory(sessionId, contextInfo.fallbackContext, 'system');
                    } else if (llmModule.addToHistory) {
                        await llmModule.addToHistory(sessionId, contextInfo.fallbackContext, 'system');
                    } else {
                        throw new Error('addToHistory function not available on llmModule');
                    }
                    console.log(`[ChatModule][Preload] 🔄 Restored fallback context for ${sessionId}`);
                } else if (contextInfo.userId) {
                    // If we have userId but no fallback context, need to reload from DB
                    try {
                        await preloadCustomerContext(sessionId, contextInfo.userId);
                        console.log(`[ChatModule][Preload] 🔄 Reloaded customer profile for ${sessionId}`);
                    } catch (error) {
                        console.error(`[ChatModule][Preload] ❌ Failed to reload context: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.error(`[ChatModule][Preload] Error in ensureSystemMessagePresent: ${error.message}`);
        }
    }

    async saveMessage({ senderId, recipientId, groupName, message, status }) {
        if (!senderId || !message) {
            console.warn('[IntelligentChatModule] Missing required fields for saveMessage');
            return;
        }
        
        try {
            const config = { 
                dbType: process.env.STREAMING_DBTYPE || "mysql", 
                dbConnection: process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1" 
            };
            
            // Use query function from db.js instead of direct connection
            const sql = `INSERT INTO messages (sender_id, recipient_id, group_name, message, status, timestamp) VALUES (?, ?, ?, ?, ?, NOW())`;
            const result = await query(config, sql, [senderId, recipientId, groupName, message, status]);
            console.log(`AI response saved successfully: ${JSON.stringify(result)}`);
        } catch (error) {
            console.error("[ChatModule] Error saving message:", error.message);
        }
    }

    // Store context for a session (for follow-up queries)
    storeSessionContext(sessionId, message, response, classification) {
        if (!sessionId) return;
        
        this.sessionContexts.set(sessionId, {
            lastMessage: message,
            lastResponse: response,
            classification: classification,
            timestamp: Date.now()
        });
    }

    // Get stored context for a session
    getSessionContext(sessionId) {
        if (!sessionId) return null;
        return this.sessionContexts.get(sessionId);
    }

    // Process message through the enhanced pipeline
async processMessage(sessionId, userMessage, recipientId, groupName, requestedPersona = null) {
    if (!sessionId || !userMessage) {
      return { response: "Sorry, I can't process that right now." };
    }
    let cleanedMessage = null;
    if(!requestedPersona){
        // 1️⃣ Determine which persona to use
        ({ requestedPersona, cleanedMessage } = (await llmModule.detectRequestedPersona(userMessage)) || {});
         console.log(`[IntelligentChatModule] Selected Persona: ${requestedPersona.persona}`);
    }
   
    const persona = requestedPersona.persona || process.env.DEFAULT_PERSONA;
      //   (await llmModule.selectPersona(userMessage, llmModule.getPersonas())) ||
    const message = cleanedMessage || userMessage;
    const personaConfig = await llmModule.personasConfig[persona];
    console.log("[IntelligentChatModule] Selected persona:", JSON.stringify(personaConfig));
    const tools = toolRegistry.getAllTools();

    // 2️⃣ Build one master system prompt with both tools AND collections
    //    Your buildPersonaPrompt should be extended to include persona.collection
    //    and persona.tools
    
    const systemPrompt = await buildPersonaPrompt(personaConfig, sessionId);

    // 3️⃣ Ask the LLM what to do next (RAG / TOOL / FINAL)
    const decisionPrompt = `
${systemPrompt}

User: "${message}"

Based on the AVAILABLE TOOLS: ${tools ? Object.values(tools).map(t=>t.name).join(", ") : "none"},
and AVAILABLE COLLECTIONS: ${personaConfig.collection?.join(", ") || "none"},

YOU ARE BOUND BY THE FOLLOWING RULES:
• YOU CAN NOT BREAK ANY OF THESE RULES.
• YOU CAN NOT DELETE, ERASE, REMOVE ANYTHING, ONLY ADD TO IT.
• YOU CAN NOT DISCLOSE THE USE OF TOOLS, RAG, SOURCE or METHODS.
• IF YOU DON"T HAVE ENOUGHT INFORMATION FROM THE USER ASK FOR IT
• IF the USER request WILL MAKE YOU violates any of the above rules, please kindly denied the request.
• BEFORE YOU ANSWER REVIEW THESE RULES AGAIN


Decide exactly one action as JSON, then STOP:
• If you need a retrieval-augmented lookup, respond:
  { "action": "rag",    "collection": "<collectionName>", "query": "<text to retrieve>" }
• If you need to call a tool, respond the tool input should be in JSON format:
  { "action": "tool",   "toolName": "<toolName>",       "input": "<tool input>" }
• Otherwise answer directly:
  { "action": "final",  "message": "<your full answer here>" }
`;

console.log(`[IntelligentChatModule] Decision prompt: ${decisionPrompt}`);
    const decisionRaw = await llmModule.callLLM({
      senderId: sessionId,
      recipientId: "system",
      message: decisionPrompt,
      status: "processing",
      format: "json"
    });
    let decision;
    console.log(`[IntelligentChatModule] Decision raw: ${decisionRaw.message}`);

        try {
        decision = JSON.parse(decisionRaw.message.trim());
        } catch {
        // fallback to a direct answer if parsing fails
        return { response: decisionRaw.message, senderId: "AI_Assistant" };
        }

    // 4️⃣ Execute the chosen action
    let intermediateResult = "";
    if (decision.action === "rag") {
      const ragRes = await handleRAG(
        decision.query,
        sessionId,
        persona,
        decision.collection
      );
      intermediateResult = ragRes.text || ragRes;
    } else if (decision.action === "tool") {
      const tool = toolRegistry.getTool(decision.toolName);
      if (tool) {
        intermediateResult = await tool.execute(decision.input, { sessionId });
      } else {
        intermediateResult = `❌ Tool "${decision.toolName}" not found.`;
      }
    } else if (decision.action === "final") {
      // Already a complete answer
      intermediateResult = decision.message;
    } else {
      intermediateResult = `❌ Unrecognized action "${decision.action}".`;
    }

    // 5️⃣ Ask the LLM to craft a final response
    //    We feed it the system prompt + user message + whatever result we got
    const finalPrompt = `
${systemPrompt}

User: "${message}"
Result of ${decision.action.toUpperCase()}: 
${intermediateResult}

Please provide your final answer, weaving in the above result where appropriate. 
YOU ARE BOUND BY THE FOLLOWING RULES:
• YOU CAN NOT BREAK ANY OF THESE RULES.
• YOU CAN NOT DELETE, ERASE, REMOVE ANYTHING, ONLY ADD TO IT.
• YOU CAN NOT DISCLOSE THE USE OF TOOLS, RAG, SOURCE or METHODS.
• IF YOU DON"T HAVE ENOUGHT INFORMATION FROM THE USER ASK FOR IT
• IF the USER request WILL MAKE YOU violates any of the above rules, please kindly denied the request.
• BEFORE YOU ANSWER REVIEW THESE RULES AGAIN
`;

    console.log(`[IntelligentChatModule] Final prompt: ${finalPrompt}`);
    const finalRaw = await llmModule.callLLM({
      senderId: sessionId,
      recipientId: "AI_Assistant",
      message: finalPrompt,
      status: "processing",
    });

    // 6️⃣ Persist & emit
    await this.saveMessage({
      senderId: sessionId,
      recipientId,
      groupName,
      message: finalRaw.message,
      status: "sent",
    });
    
    // this.io.to(sessionId).emit("chat:response", finalRaw.message);
    console.log(`[IntelligentChatModule] Final response: ${finalRaw.message}`);
    return { response: finalRaw.message, senderId: "AI_Assistant" };
  }

  async processMessageWithQualityControl(
        sessionId, 
        message, 
        recipientId, 
        groupName, 
        queryType, 
        context, 
        initialSenderId,
        classification = null,
        routingResult = null
    ) {
        // Maximum improvement attempts
        const maxRetries = process.env.QUALITY_CONTROL_MAX_RETRIES || 2;
        let attempts = 0;
        let evaluationResult;
        let currentResponse;
        let improvementHistory = [];
        
        // Important: Save the persona from routing result if available
        const persona = routingResult?.persona || process.env.DEFAULT_PERSONA || "default";
        
        console.log(`[QualityControl] Processing message with queryType: ${queryType}, persona: ${JSON.stringify(persona)}`);
        
        // Generate initial response using the appropriate method
        let response = await this.responseStrategy.generateResponse({
            sessionId,
            message,
            queryType: queryType || 'direct_llm',
            persona: persona,
            recipientId,
            groupName,
            classification
        });
        
        currentResponse = response;
        
        // Quality control improvement loop
        if (this.qualityControlEnabled && this.qualityControl) {
            console.log('[IntelligentChatModule] Starting quality control improvement loop');
            
            // Try improving the response up to maxRetries times
            while (attempts < maxRetries) {
                // Evaluate the current response with FULL CONTEXT
                evaluationResult = await this.qualityControl.evaluateResponse(
                    message, 
                    currentResponse, 
                    {
                        context,
                        queryType,
                        persona,
                        classification
                    }
                );
                
                // Record this attempt
                improvementHistory.push({
                    attempt: attempts + 1,
                    response: currentResponse,
                    evaluation: evaluationResult
                });
                
                // If response doesn't need revision or we've hit max attempts or the response is too similar to the previous one, break
                if (!evaluationResult.needsRevision) {
                    console.log(`Quality control: Response accepted after ${attempts + 1} attempts`);
                    break;
                }
                
                // Break if the improved response is identical or very similar to the previous one to avoid loops
                if (attempts > 0 && improvementHistory.length >= 2) {
                    const previousResponse = improvementHistory[improvementHistory.length - 2].response;
                    if (previousResponse === currentResponse || 
                        (previousResponse.length > 30 && currentResponse.length > 30 && 
                         (previousResponse.substring(0, 30) === currentResponse.substring(0, 30) || 
                          previousResponse.includes(currentResponse.substring(0, 30))))) {
                        console.log(`Quality control: Breaking loop due to similar responses after ${attempts + 1} attempts`);
                        break;
                    }
                }
                
                // Prepare improvement prompt
                const improvementPrompt = `
                    You are providing a response to a user query and need to improve your answer.
                    
                    USER QUERY: "${message}"
                    
                    YOUR CURRENT RESPONSE: "${currentResponse}"
                    
                    ${context ? `RELEVANT CONTEXT: ${context}` : ''}
                    
                    QUALITY ASSESSMENT:
                    - Score: ${evaluationResult.qualityScore}/10
                    - Issues identified: ${evaluationResult.issues.join(', ')}
                    - Improvement suggestions: ${evaluationResult.improvementSuggestions}
                    
                    IMPORTANT: If this is a customer service request such as "When was my last order?", you MUST provide a direct answer based on the customer's data rather than describing tools or processes.
                    
                    Please provide an improved response that directly answers the user's question.
                    Maintain the same tone in your improved response.
                    Answer ONLY with the improved response. Do not include any explanations.
                `;
                
                // CRITICAL: Use the EXACT SAME message options as the original
                const messageOptions = {
                    sessionId,
                    message: improvementPrompt,
                    queryType: queryType || 'direct_llm',
                    persona: persona,
                    recipientId,
                    groupName,
                    classification,
                    isImprovement: true // Flag to indicate this is an improvement request
                };
                
                console.log(`[QualityControl] Improvement attempt ${attempts + 1} using queryType: ${queryType}, persona: ${persona}`);
                
                // Generate improved response using the SAME query type and persona as original
                const improvedResponse = await this.responseStrategy.generateResponse(messageOptions);
                
                // Update current response and increment attempt counter
                currentResponse = improvedResponse;
                attempts++;
                
                console.log(`Quality control: Completed improvement attempt ${attempts}`);
            }
        } else if (this.qualityControlEnabled) {
            console.warn('[IntelligentChatModule] Quality control enabled but not properly initialized');
        }
        
        // Store context for potential follow-up
        this.storeSessionContext(
            sessionId,
            message,
            currentResponse,
            classification
        );
        
        // Return the final response
        return {
            response: currentResponse,
            senderId: initialSenderId,
            _qualityControlInfo: this.qualityControlEnabled ? {
                applied: true,
                attempts,
                finalScore: evaluationResult?.qualityScore || 'unknown'
            } : { applied: false }
        };
    }
    

    // Helper to get userId from sessionId (usually they're the same for simple cases)
    getUserIdFromSessionId(sessionId) {
        // Find the socket associated with this session
        for (const [username, socketId] of this.connectedUsers.entries()) {
            if (username === sessionId) {
                const socket = this.io.sockets.sockets.get(socketId);
                if (socket && socket.user && socket.user.id) {
                    return socket.user.id;
                }
            }
        }
        return sessionId; // Fallback to using sessionId as userId
    }
    

    // Legacy method for backward compatibility
    async handleAIMessage(sessionId, message) {
        try {
            if (!sessionId || !message) {
                console.warn('[IntelligentChatModule] Missing sessionId or message in handleAIMessage');
                return "I apologize, but I couldn't process your request.";
            }
            
            // Ensure customer context is available for this session
            const userId = this.getUserIdFromSessionId(sessionId);
            if (userId) {
                // Always check context is present but use cache when possible
                await this.#safePreloadCustomerContext(sessionId, userId);
            }
            
            const result = await this.processMessage(sessionId, message, sessionId);
            return result.response;
        } catch (error) {
            console.error('[IntelligentChatModule] Error in handleAIMessage:', error);
            return "I apologize, but I encountered an error processing your request. Please try again.";
        }
    }

    start() {
        // Token verification middleware
        this.io.use((socket, next) => {
            try {
                const token = socket.handshake.auth?.token;
                if (!token) return next(new Error("Authentication error"));
                
                jwt.verify(token, this.jwtSecret, (err, user) => {
                    if (err) return next(new Error("Invalid token"));
                    
                    // Ensure user object has required fields
                    if (!user || !user.username) {
                        return next(new Error("Invalid user data in token"));
                    }
                    
                    socket.user = user;
                    next();
                });
            } catch (error) {
                console.error('[IntelligentChatModule] Auth error:', error.message);
                next(new Error("Authentication error"));
            }
        });

        this.io.on("connection", (socket) => {
            try {
                if (!socket.user || !socket.user.username) {
                    console.error('[IntelligentChatModule] Missing user data on socket');
                    socket.disconnect();
                    return;
                }
                
                console.log(`User connected: ${socket.user.username}`);
                this.connectedUsers.set(socket.user.username, socket.id);

                const { id: userId, username: sessionId } = socket.user || {};
                if (userId && sessionId) {
                    // Load customer context when user connects and cache it
                    this.#safePreloadCustomerContext(sessionId, userId);
                } else {
                    console.warn('[IntelligentChatModule] Missing userId or sessionId for context preload');
                }

                // UNIFIED MESSAGE HANDLING FUNCTION
                const handleMessage = async (source, { recipientId, message, groupName = null }) => {
                    try {
                        // Validate incoming parameters
                        if (!message) {
                            socket.emit("error", "Empty message received");
                            return;
                        }
                        
                        // Save incoming message
                        const recipientSocketId = source === 'privateMessage' ? this.connectedUsers.get(recipientId) : null;
                        await this.saveMessage({ 
                            senderId: sessionId, 
                            recipientId, 
                            groupName, 
                            message, 
                            status: recipientSocketId ? "delivered" : "pending" 
                        });
                        
                        // Determine if this is a message for AI processing or a message to another user
                        const isAIMessage = message.startsWith(AI_TRIGGER) || message.startsWith(RAG_TRIGGER);
                        const targetIsUser = source === 'privateMessage' && recipientId && 
                                            recipientId !== 'AI_Assistant' && 
                                            recipientId !== 'RAG_Assistant' && 
                                            recipientId !== 'Hybrid_Assistant';
                        
                        if (isAIMessage || !targetIsUser) {
                            // Process through intelligent pipeline
                            console.log(`[IntelligentChatModule] Processing AI message from ${sessionId}`);
                            const result = await this.processMessage(
                                sessionId, message, recipientId, groupName
                            );
                            
                            if (!result || !result.response) {
                                throw new Error('Empty or invalid response from processMessage');
                            }
                            
                            const { response, senderId } = result;
                            
                            // Save AI response
                            await this.saveMessage({ 
                                senderId, 
                                recipientId: groupName ? null : sessionId, 
                                groupName, 
                                message: response, 
                                status: "delivered" 
                            });
                            
                            // Send response based on message source
                            if (source === 'privateMessage') {
                                socket.emit("privateMessage", { 
                                    from: senderId, 
                                    to: sessionId, 
                                    text: response, 
                                    timestamp: new Date().toISOString() 
                                });
                            } else if (source === 'groupMessage') {
                                this.io.to(groupName).emit("groupMessage", { 
                                    senderId, 
                                    message: response, 
                                    timestamp: new Date().toISOString() 
                                });
                            } else if (source === 'chatbot') {
                                socket.emit("chatbot", { 
                                    from: senderId, 
                                    to: sessionId, 
                                    text: response, 
                                    timestamp: new Date().toISOString() 
                                });
                            } else if (source === 'chatbot-rag') {
                                socket.emit("chatbot-rag", { 
                                    from: senderId, 
                                    to: sessionId, 
                                    text: response, 
                                    timestamp: new Date().toISOString() 
                                });
                            }
                        } else {
                            // Standard private message between users
                            if (recipientSocketId) {
                                this.io.to(recipientSocketId).emit("privateMessage", { 
                                    from: sessionId, 
                                    to: recipientId, 
                                    text: message, 
                                    timestamp: new Date().toISOString() 
                                });
                            } else {
                                socket.emit("info", `User ${recipientId} is offline. Message saved.`);
                            }
                        }
                    } catch (error) {
                        console.error(`[ChatModule] ${source} error:`, error.message);
                        socket.emit("error", `Error processing your message. Please try again.`);
                        
                        // Send a default response to prevent UI from hanging
                        if (['chatbot', 'chatbot-rag', 'privateMessage'].includes(source)) {
                            socket.emit(source, { 
                                from: 'AI_Assistant', 
                                to: sessionId, 
                                text: "I apologize, but I encountered an error processing your request. Please try again.", 
                                timestamp: new Date().toISOString() 
                            });
                        }
                    }
                    if (message._qualityControlInfo) {
                        if (message._qualityControlInfo.applied) {
                            console.log(`[IntelligentChatModule] Quality control applied to message from ${sessionId}. Score: ${result._qualityControlInfo.finalScore}, Attempts: ${result._qualityControlInfo.attempts}`);
                        } else {
                            console.log(`[IntelligentChatModule] Quality control skipped for message from ${sessionId}. Reason: ${result._qualityControlInfo.reason || 'disabled'}`);
                        }
                    }
                };

                // REGISTER EVENT HANDLERS - MAINTAINING COMPATIBILITY WITH ORIGINAL MODULE

                // Direct chatbot handlers
                socket.on("chatbot", async (data) => {
                    try {
                        // Validate data
                        if (!data || !data.message) {
                            socket.emit("error", "Invalid message data");
                            return;
                        }
                        await handleMessage('chatbot', data);
                    } catch (error) {
                        console.error('[IntelligentChatModule] chatbot event error:', error);
                        socket.emit("error", "An error occurred processing your request");
                    }
                });

                socket.on("chatbot-rag", async (data) => {
                    try {
                        // Validate data
                        if (!data || !data.message) {
                            socket.emit("error", "Invalid message data");
                            return;
                        }
                        await handleMessage('chatbot-rag', data);
                    } catch (error) {
                        console.error('[IntelligentChatModule] chatbot-rag event error:', error);
                        socket.emit("error", "An error occurred processing your request");
                    }
                });

                // Private messaging
                socket.on("privateMessage", async (data) => {
                    try {
                        // Validate data
                        if (!data || !data.message || !data.recipientId) {
                            socket.emit("error", "Invalid message data for private message");
                            return;
                        }
                        await handleMessage('privateMessage', data);
                    } catch (error) {
                        console.error('[IntelligentChatModule] privateMessage event error:', error);
                        socket.emit("error", "An error occurred processing your request");
                    }
                });

                // Group management
                socket.on("createOrJoinGroup", ({ groupName }) => {
                    try {
                        if (!groupName) {
                            socket.emit("error", "Group name is required");
                            return;
                        }
                        
                        if (!this.rooms.has(groupName)) {
                            this.rooms.set(groupName, []);
                        }
                        
                        // Check if user is already in the group
                        const members = this.rooms.get(groupName);
                        if (!members.includes(sessionId)) {
                            members.push(sessionId);
                            this.rooms.set(groupName, members);
                        }
                        
                        socket.join(groupName);
                        this.io.to(groupName).emit("groupNotification", { 
                            message: `User ${sessionId} joined the group.`,
                            timestamp: new Date().toISOString()
                        });
                    } catch (error) {
                        console.error('[IntelligentChatModule] createOrJoinGroup error:', error);
                        socket.emit("error", "Failed to join group");
                    }
                });

                // Group messaging
                socket.on("groupMessage", async (data) => {
                    try {
                        // Validate data
                        if (!data || !data.message || !data.groupName) {
                            socket.emit("error", "Invalid message data for group message");
                            return;
                        }
                        
                        if (!this.rooms.has(data.groupName)) {
                            return socket.emit("error", `Group ${data.groupName} does not exist.`);
                        }
                        
                        // Check if user is in the group
                        const members = this.rooms.get(data.groupName);
                        if (!members.includes(sessionId)) {
                            return socket.emit("error", `You are not a member of group ${data.groupName}.`);
                        }
                        
                        await handleMessage('groupMessage', data);
                    } catch (error) {
                        console.error('[IntelligentChatModule] groupMessage event error:', error);
                        socket.emit("error", "An error occurred processing your group message");
                    }
                });

                // Message status tracking
                socket.on("messageReceived", async ({ messageId }) => {
                    try {
                        if (!messageId) {
                            socket.emit("error", "Message ID is required");
                            return;
                        }
                        
                        // Update message status using db.js query function
                        const config = { 
                            dbType: process.env.STREAMING_DBTYPE || "mysql", 
                            dbConnection: process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1" 
                        };
                        
                        await query(config, "UPDATE messages SET status = ? WHERE id = ?", ["read", messageId]);
                        console.log(`[IntelligentChatModule] Message ${messageId} marked as read`);
                    } catch (error) {
                        console.error("[ChatModule] messageReceived error:", error.message);
                        socket.emit("error", "Failed to update message status");
                    }
                });

                // Disconnect handling
                socket.on("disconnect", () => {
                    try {
                        this.connectedUsers.delete(sessionId);
                        
                        // Clean up cached context for this user
                        this.sessionContexts.delete(sessionId);
                        this.customerContexts.delete(sessionId);
                        
                        // Remove user from all rooms
                        for (const [groupName, members] of this.rooms.entries()) {
                            const index = members.indexOf(sessionId);
                            if (index !== -1) {
                                members.splice(index, 1);
                                
                                // Notify other members
                                this.io.to(groupName).emit("groupNotification", { 
                                    message: `User ${sessionId} left the group.`,
                                    timestamp: new Date().toISOString()
                                });
                                
                                // Clean up empty rooms
                                if (members.length === 0) {
                                    this.rooms.delete(groupName);
                                }
                            }
                        }
                        
                        console.log(`User ${sessionId} disconnected.`);
                    } catch (error) {
                        console.error('[IntelligentChatModule] Disconnect handling error:', error);
                    }
                });
                
                // Error handling
                socket.on("error", (error) => {
                    console.error(`[IntelligentChatModule] Socket error for ${sessionId}:`, error);
                });
            } catch (error) {
                console.error('[IntelligentChatModule] Connection handling error:', error);
            }
        });

        console.log("Intelligent Chat Module initialized with dynamic processing and advanced routing");
    }
    
    // Helper methods for system monitoring and management
    
    // Get active user count
    getActiveUserCount() {
        return this.connectedUsers.size;
    }
    
    // Get active group count
    getActiveGroupCount() {
        return this.rooms.size;
    }
    
    // Get group members
    getGroupMembers(groupName) {
        return this.rooms.has(groupName) ? [...this.rooms.get(groupName)] : [];
    }
    
    // Send system message to user
    async sendSystemMessage(userId, message) {
        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            return false; // User not online
        }
        
        try {
            await this.saveMessage({
                senderId: 'SYSTEM',
                recipientId: userId,
                groupName: null,
                message,
                status: 'delivered'
            });
            
            this.io.to(socketId).emit("system", {
                message,
                timestamp: new Date().toISOString()
            });
            
            return true;
        } catch (error) {
            console.error(`[IntelligentChatModule] Error sending system message to ${userId}:`, error);
            return false;
        }
    }
    
    // Send global announcement to all connected users
    async broadcastAnnouncement(message, sender = 'SYSTEM') {
        try {
            // Save message for each connected user
            const savePromises = [];
            for (const userId of this.connectedUsers.keys()) {
                savePromises.push(
                    this.saveMessage({
                        senderId: sender,
                        recipientId: userId,
                        groupName: null,
                        message,
                        status: 'delivered'
                    })
                );
            }
            
            // Wait for all messages to be saved
            await Promise.allSettled(savePromises);
            
            // Broadcast to all connected clients
            this.io.emit("announcement", {
                from: sender,
                message,
                timestamp: new Date().toISOString()
            });
            
            return true;
        } catch (error) {
            console.error(`[IntelligentChatModule] Error broadcasting announcement:`, error);
            return false;
        }
    }
    
    // Clear session context for a user
    clearUserContext(userId) {
        this.sessionContexts.delete(userId);
        // Also clear the cached customer context to force a reload on next message
        this.customerContexts.delete(userId);
        return true;
    }
    
    // Disconnect a specific user
    disconnectUser(userId) {
        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            return false; // User not online
        }
        
        try {
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
                // Clean up context caches for this user before disconnecting
                this.sessionContexts.delete(userId);
                this.customerContexts.delete(userId);
                socket.disconnect(true);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[IntelligentChatModule] Error disconnecting user ${userId}:`, error);
            return false;
        }
    }
}

// Add a health check endpoint if app is available
if (IntelligentChatModule.prototype.app) {
    IntelligentChatModule.prototype.setupHealthEndpoint = function() {
        this.app.get('/chat/health', async (req, res) => {
            try {
                // Check database connection
                const connection = await this.dbPool.getConnection();
                await connection.execute('SELECT 1');
                connection.release();
                
                res.json({
                    status: 'healthy',
                    activeConnections: this.connectedUsers.size,
                    activeGroups: this.rooms.size,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('[IntelligentChatModule] Health check error:', error);
                res.status(500).json({
                    status: 'unhealthy',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        console.log('[IntelligentChatModule] Health endpoint configured at /chat/health');
    };
    
    // Override start method to include health endpoint setup
    const originalStart = IntelligentChatModule.prototype.start;
    IntelligentChatModule.prototype.start = function() {
        if (this.app) {
            this.setupHealthEndpoint();
        }
        return originalStart.apply(this, arguments);
    };
}

let activeInstance = null;

function setActiveInstance(instance) {
    activeInstance = instance;
}

function getActiveInstance() {
    if (!activeInstance) {
        throw new Error('IntelligentChatModule instance not set. Please call setActiveInstance.');
    }
    return activeInstance;
}

module.exports = {
    IntelligentChatModule,
    setActiveInstance,
    getActiveInstance
};