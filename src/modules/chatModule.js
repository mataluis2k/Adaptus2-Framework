const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");

class ChatModule {
    constructor(httpServer, app, jwtSecret, dbConfig) {
        // Initialize Socket.IO
        this.io = new Server(httpServer, {
            cors: {
                origin: "*", // Update based on your frontend origin
                methods: ["GET", "POST"],
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
        const query = `
            INSERT INTO messages (sender_id, recipient_id, group_name, message, status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const timestamp = new Date().toISOString();

        try {
            const connection = await this.dbPool.getConnection();
            await connection.execute(query, [
                senderId,
                recipientId,
                groupName,
                message,
                status,
                timestamp,
            ]);
            connection.release();
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
            console.log(`User connected: ${socket.id}, userId: ${socket.user.userId}`);

            // Track connected user
            this.connectedUsers.set(socket.user.userId, socket.id);

            // Event: One-to-one message
            socket.on("privateMessage", async ({ recipientId, message }) => {
                const recipientSocketId = this.connectedUsers.get(recipientId);

                // Save message in the database
                const messageData = {
                    senderId: socket.user.userId,
                    recipientId,
                    groupName: null,
                    message,
                    status: recipientSocketId ? "delivered" : "pending",
                };
                await this.saveMessage(messageData);

                // Send the message if the recipient is online
                if (recipientSocketId) {
                    this.io.to(recipientSocketId).emit("privateMessage", {
                        senderId: socket.user.userId,
                        message,
                        timestamp: new Date().toISOString(),
                    });
                } else {
                    socket.emit("info", `User ${recipientId} is offline. Message saved.`);
                }
            });

            // Event: Create or join group
            socket.on("createOrJoinGroup", ({ groupName }) => {
                if (!this.rooms.has(groupName)) {
                    this.rooms.set(groupName, []);
                }
                this.rooms.get(groupName).push(socket.user.userId);
                socket.join(groupName);
                this.io.to(groupName).emit("groupNotification", {
                    message: `User ${socket.user.userId} joined the group.`,
                });
                console.log(`User ${socket.user.userId} joined group: ${groupName}`);
            });

            // Event: Group message
            socket.on("groupMessage", async ({ groupName, message }) => {
                if (this.rooms.has(groupName)) {
                    // Save message in the database
                    const messageData = {
                        senderId: socket.user.userId,
                        recipientId: null,
                        groupName,
                        message,
                        status: "delivered",
                    };
                    await this.saveMessage(messageData);

                    // Broadcast the message to group members
                    this.io.to(groupName).emit("groupMessage", {
                        senderId: socket.user.userId,
                        message,
                        timestamp: new Date().toISOString(),
                    });
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
                this.connectedUsers.delete(socket.user.userId);
                console.log(`User ${socket.user.userId} disconnected.`);
            });
        });

        console.log("Chat module initialized with authentication, persistence, and receipts.");
    }
}

module.exports = ChatModule;
