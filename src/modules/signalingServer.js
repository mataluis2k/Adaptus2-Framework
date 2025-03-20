const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { getMyConfig } = require('./apiConfig'); // Access Adaptus2 API config
const redis = require('./redisClient'); // Optional for scaling WebSockets

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';
const SIGNALING_PORT = process.env.WS_SIGNALING_PORT || 4000;

class SignalingServer {
    constructor(server) {
        this.wss = new WebSocket.Server({ server });
        this.rooms = {}; // Room storage: { roomId: [sockets] }
        this.clients = {}; // Track connected users
        this.config = getMyConfig('signalingServer.json');
        this.setupWebSocket();
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log('New WebSocket connection');

            // Authenticate user using JWT
            const token = req.url.split('?token=')[1];
            if (!token) {
                ws.close(4001, 'Unauthorized');
                return;
            }
            /*  "credentialsObject": {
                    "userId": "id",
                    "nickName": "userName",
                    "avatar": "avatar"
                } */
            const credentialsMap = this.config.credentialsObject;
            let userId;
            try {
                const decoded = jwt.verify(token, JWT_SECRET);                
                userId = decoded[credentialsMap.userId];
                // Store the WebSocket connection                
                this.clients[userId] = ws;
            } catch (err) {
                ws.close(4001, 'Invalid token');
                return;
            }

            ws.on('message', (message) => this.handleMessage(userId, message));

            ws.on('close', () => {
                console.log(`User ${userId} disconnected`);
                this.cleanupUser(userId);
            });
        });
    }

    handleMessage(userId, message) {
        console.log(`Received message from user ${userId}: ${message}`);
        const data = JSON.parse(message);
    
        switch (data.type) {
            case 'join':
                this.handleJoin(userId, data.roomId);
                break;
            case 'offer':
            case 'answer':
            case 'candidate':
                this.relayMessage(userId, data);
                break;
            case 'leave':
                this.handleLeave(userId, data.roomId);
                break;
            case 'screen_share':
                    this.broadcastToRoom(data.roomId, { type: 'screen_share', userId, screenSharing: data.screenSharing });
                    break;
            case 'chat_message':
                console.log(`In Room: ${data.roomId}, User ${userId} sent a message: ${data.message}`);
                this.broadcastToRoom(data.roomId, {
                    type: 'chat_message',
                    senderId: userId,
                    message: data.message,
                });
                break;
            case 'file_meta':
                this.broadcastToRoom(data.roomId, {
                    type: 'file_meta',
                    userId,
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                });
                break;
        }
    }
    
    broadcastToRoom(roomId, message) {
        if (!this.rooms[roomId]) return;
        this.rooms[roomId].forEach((peer) => peer.send(JSON.stringify(message)));
    }

    handleJoin(userId, roomId) {
        if (!this.rooms[roomId]) this.rooms[roomId] = [];

        // Notify other peers in the room
        this.rooms[roomId].forEach((peer) => {
            peer.send(JSON.stringify({ type: 'new_peer', userId }));
        });

        this.rooms[roomId].push(this.clients[userId]);
    }

    relayMessage(senderId, data) {
        if (!this.clients[data.target]) return;
        this.clients[data.target].send(JSON.stringify(data));
    }

    handleLeave(userId, roomId) {
        if (!this.rooms[roomId]) return;
        this.rooms[roomId] = this.rooms[roomId].filter((ws) => this.clients[userId] !== ws);

        if (this.rooms[roomId].length === 0) {
            delete this.rooms[roomId]; // Delete empty room
        }
    }

    cleanupUser(userId) {
        Object.keys(this.rooms).forEach((roomId) => this.handleLeave(userId, roomId));
        delete this.clients[userId];
    }
}

module.exports = SignalingServer;
