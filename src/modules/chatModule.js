const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const { getDbConnection } = require("./db");
const llmModule = require("./llmModule");
const{ handleRAG } = require("./ragHandler1");

// AI trigger prefix
const AI_TRIGGER = "/ai";
const RAG_TRIGGER = "/rag";
class ChatModule {
    constructor(httpServer, app, jwtSecret, dbConfig, corsOptions) {
        // Initialize Socket.IO
        this.io = new Server(httpServer, {
            cors: {
                origin: corsOptions.origin, // Update based on your frontend origin
                methods: corsOptions.methods,
            },
        });

        this.jwtSecret = jwtSecret;
        this.connectedUsers = new Map();
        this.rooms = new Map(); // Store group room information

        // Initialize database connection pool
        this.dbPool = mysql.createPool(dbConfig);

        this.app = app; // Reference to the existing Express app
    }

    async saveMessage({ senderId, recipientId, groupName, message, status }) {
        const dbType = process.env.STREAMING_DBTYPE || "mysql";
        const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";
    
        const config = { dbType, dbConnection };            
        const timestamp = new Date().toISOString();
    
        const sql = `
            INSERT INTO messages (sender_id, recipient_id, group_name, message, status, timestamp)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;
    
        const values = [senderId, recipientId, groupName, message, status];
    
        try {
            // Get the database connection
            const connection = await getDbConnection(config);
    
            // Execute the query
            const [result] = await connection.execute(sql, values);
    
            console.log("Message saved successfully:", result);          
        } catch (error) {
            console.error("Error saving message:", error.message);
        }
    }

    start() {
        // Middleware: Authenticate users
        this.io.use((socket, next) => {
            const token = socket.handshake.auth?.token;
            if (!token) return next(new Error("Authentication error"));

            jwt.verify(token, this.jwtSecret, (err, user) => {
                if (err) return next(new Error("Invalid token"));
                socket.user = user; // Attach user data to the socket
                next();
            });
        });

        this.io.on("connection", (socket) => {
            console.log(`User connected: ${socket.id}, username: ${socket.user.username}`);

            // Track connected user
            this.connectedUsers.set(socket.user.username, socket.id);

            // Event: One-to-one message
            socket.on("privateMessage", async ({ recipientId, message }) => {
                console.log(`Private message from ${socket.user.username} to ${recipientId}: ${message}`);
                try {
                    const recipientSocketId = this.connectedUsers.get(recipientId);
                    const isAiQuery = message.trim().toLowerCase().startsWith(AI_TRIGGER);
                    const isRagQuery = message.trim().toLowerCase().startsWith(RAG_TRIGGER);

                    // Save message in the database
                    const messageData = {
                        senderId: socket.user.username,
                        recipientId,
                        groupName: null,
                        message,
                        status: recipientSocketId ? "delivered" : "pending",
                    };
                    await this.saveMessage(messageData);

                   

                    // Process with Ollama only if AI is triggered
                    if (isAiQuery) {
                        const aiPrompt = message.slice(AI_TRIGGER.length).trim();
                        const aiResponse = await llmModule.processMessage({
                            ...messageData,
                            message: aiPrompt
                        });
                        console.log("AI response:", aiResponse);

                        // Remove all the text between <think> and </think> tags including the tags themselves
                        aiResponse.message = aiResponse.message.replace(/<think(?:\s[^>]*)?>[^]*?<\/think>/g, '');

                        // Send AI response back to the sender
                        socket.emit("privateMessage", {
                            from: "AI_Assistant",
                            to: socket.user.username,
                            text: aiResponse.message,
                            timestamp: new Date().toISOString(),
                        });
                       
                        
                    }
                    // Adding RAG handler
                    if (isRagQuery) {
                        try {
                            const ragPrompt = message.slice(RAG_TRIGGER.length).trim();
                            const ragResponse = await handleRAG(ragPrompt);
                            console.log("RAG response:", ragResponse);
                            
                            // Send Back RAG response to the sender
                            socket.emit("privateMessage", {
                                from: "RAG_Assistant",
                                to: socket.user.username,
                                text: ragResponse.text || ragResponse,
                                timestamp: new Date().toISOString(),
                            });
                            
                            // If recipient is online, also send them the RAG response
                            if (recipientSocketId) {
                                this.io.to(recipientSocketId).emit("privateMessage", {
                                    from: "RAG_Assistant",
                                    to: recipientId,
                                    text: ragResponse.text || ragResponse,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                        } catch (error) {
                            console.error("RAG Error:", error.message);
                            socket.emit("privateMessage", {
                                from: "RAG_Assistant",
                                to: socket.user.username,
                                text: "Error processing RAG query: " + error.message,
                                timestamp: new Date().toISOString(),
                            });
                        }
                    }
                    
                    // if recipient is AI_Assistant, we don't send the response to them
                    if (recipientId === "AI_Assistant") {
                        return;
                    }
                    
                    // If recipient is online and AI was triggered, send them the AI response
                    if (recipientSocketId && isAiQuery) {
                        this.io.to(recipientSocketId).emit("privateMessage", {
                            from: "AI_Assistant",
                            to: recipientId,
                            text: aiResponse.message,
                            timestamp: new Date().toISOString(),
                        });
                    }
                     // Send the message if the recipient is online
                     if (recipientSocketId && !isAiQuery && !isRagQuery) {
                        this.io.to(recipientSocketId).emit("privateMessage", {
                            from: socket.user.username,
                            to: recipientId,
                            text: message,
                            timestamp: new Date().toISOString(),
                        });
                    } else {
                        socket.emit("info", `User ${recipientId} is offline. Message saved.`);
                    }
                    
            } catch (error) {
                console.error("Error handling privateMessage event:", error.message);
                socket.emit("error", "An error occurred while sending your message.");
            }
            });

            // Event: Create or join group
            socket.on("createOrJoinGroup", ({ groupName }) => {
                if (!this.rooms.has(groupName)) {
                    this.rooms.set(groupName, []);
                }
                this.rooms.get(groupName).push(socket.user.username);
                socket.join(groupName);
                this.io.to(groupName).emit("groupNotification", {
                    message: `User ${socket.user.username} joined the group.`,
                });
                console.log(`User ${socket.user.username} joined group: ${groupName}`);
            });

            // Event: Group message
            socket.on("groupMessage", async ({ groupName, message }) => {
                if (this.rooms.has(groupName)) {
                    const isAiQuery = message.trim().toLowerCase().startsWith(AI_TRIGGER);

                    // Save message in the database
                    const messageData = {
                        senderId: socket.user.username,
                        recipientId: null,
                        groupName,
                        message,
                        status: "delivered",
                    };
                    await this.saveMessage(messageData);

                    // Broadcast the message to group members
                    this.io.to(groupName).emit("groupMessage", {
                        senderId: socket.user.username,
                        message,
                        timestamp: new Date().toISOString(),
                    });

                    // Process with Ollama only if AI is triggered
                    if (isAiQuery) {
                        const aiPrompt = message.slice(AI_TRIGGER.length).trim();
                        const aiResponse = await llmModule.processMessage({
                            ...messageData,
                            message: aiPrompt
                        });

                        // Remove all the text between <think> and </think> tags including the tags themselves
                        aiResponse.message = aiResponse.message.replace(/<think(?:\s[^>]*)?>[^]*?<\/think>/g, '');



                        // Broadcast AI response to group
                        this.io.to(groupName).emit("groupMessage", {
                            senderId: "AI_Assistant",
                            message: aiResponse.message,
                            timestamp: new Date().toISOString(),
                        });
                    }
                } else {
                    socket.emit("error", `Group ${groupName} does not exist.`);
                }
            });

            // Event: Acknowledge receipt
            socket.on("messageReceived", async ({ messageId }) => {
                const query = `UPDATE messages SET status = ? WHERE id = ?`;
                try {
                    const connection = await this.dbPool.getConnection();
                    await connection.execute(query, ["read", messageId]);
                    connection.release();
                } catch (error) {
                    console.error("Error updating message status:", error.message);
                }
            });

            // Handle disconnection
            socket.on("disconnect", () => {
                this.connectedUsers.delete(socket.user.username);
                console.log(`User ${socket.user.username} disconnected.`);
            });
        });

        console.log("Chat module initialized with authentication, persistence, and receipts.");
    }
}

module.exports = ChatModule;
