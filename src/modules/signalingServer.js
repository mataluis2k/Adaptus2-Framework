const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const Ajv = require('ajv');
const logger = require('./logger');
const { getMyConfig } = require('./apiConfig'); // Adaptus2 API config

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable must be set');
}
const SIGNALING_PORT = process.env.WS_SIGNALING_PORT || 4000;

class SignalingServer {
    constructor(server) {
        this.wss = new WebSocket.Server({ server });
        this.rooms = {};         // { roomId: [{ userId, ws }] }
        this.clients = {};       // { userId: ws }
        this.userRooms = {};     // { userId: roomId }
        this.userSockets = new Map();  // { userId -> ws }
            // NEW PROPERTIES
        this.waitingRoomUsers = {};  // { roomId: [userId] }
        this.screenShareUsers = new Set(); // Users currently sharing screen
        this.recordingUsers = new Set(); // Users currently recording
        this.handRaisedUsers = new Set(); // Users with hand raised
        this.moderators = new Set(); // Users with moderator role
        this.admins = new Set(); // Users with admin role
        this.bannedUsers = new Set(); // Users who are banned
        this.mutedUsers = new Set(); // Users who are muted
        this.roomActivity = {}; // { roomId: lastActivityTimestamp }

        this.ajv = new Ajv();
        this.validators = this.createValidators();

        this.config = getMyConfig('signalingServer.json');
        this.setupWebSocket();
        this.startHeartbeat();
        this.startRoomCleanup();
    }
    startHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    logger.warn('Terminating dead connection');
                    // This triggers `ws.on(\'close\')` -> cleanupUser()
                    ws.terminate();
                    return;
                }

                ws.isAlive = false;
                ws.ping(); // Triggers client's pong
            });
        }, 30000); // Every 30 seconds
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            logger.info('New WebSocket connection');
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });

            const tokenHeader = (req.headers['sec-websocket-protocol'] || '').split(',')[0].trim();
            if (!tokenHeader) {
                ws.close(4001, 'Unauthorized');
                return;
            }

            const credentialsMap = this.config.credentialsObject;
            let userId;
            try {
                const decoded = jwt.verify(tokenHeader, JWT_SECRET);
                userId = decoded[credentialsMap.userId];
                if (!userId) throw new Error('Missing userId');
                if (this.bannedUsers.has(userId)) {
                    ws.close(4003, 'Banned');
                    return;
                }
                this.clients[userId] = ws;
            } catch (err) {
                logger.error('JWT validation failed:', err);
                ws.close(4001, 'Invalid token');
                return;
            }

            ws.messageCount = 0;
            ws.lastMessageTime = Date.now();

            ws.on('message', (message) => {
                // Simple rate limiting
                const now = Date.now();
                if (now - ws.lastMessageTime < 1000) {
                    ws.messageCount++;
                    if (ws.messageCount > 20) {
                        ws.close(4008, 'Rate limit exceeded');
                        return;
                    }
                } else {
                    ws.messageCount = 1;
                    ws.lastMessageTime = now;
                }

                try {
                    const data = JSON.parse(message);
                    if (!this.validateMessage(data)) {
                        logger.warn('Invalid message from', userId, data);
                        return;
                    }
                    if (data.type === 'join') {
                        userId = data.senderId;
                        this.clients[userId] = ws;
                        ws.userId = userId;
                        this.handleJoin(userId, data.roomId);
                    } else if (userId) {
                        this.handleMessage(userId, data);
                    }
                } catch (err) {
                    logger.error('Failed to parse message:', err);
                }
            });
            ws.on('error', (err) => {
                logger.error('WebSocket error', err);
            });
            ws.on('close', () => {
                const currentUserId = ws.userId;
                this.cleanupUser(currentUserId);
                logger.info(`User ${currentUserId} disconnected`);
            });
        });
    }

    handleMessage(userId, data) {
        logger.debug(`Received from ${userId}: ${JSON.stringify(data)}`);
        

        switch (data.type) {
            case 'join':
                this.handleJoin(userId, data.roomId);
                break;

            case 'offer':
            case 'answer':
            case 'candidate':
                if (this.userRooms[data.target] !== this.userRooms[userId]) {
                    logger.warn('Target user not in same room');
                    break;
                }
                this.relayMessage(userId, data.target, data);
                break;
            case 'screen_share':
                    const isScreenSharing = data.screenSharing;
                    if (isScreenSharing) {
                        this.screenShareUsers.add(userId);
                    } else {
                        this.screenShareUsers.delete(userId);
                    }
                    
                    this.broadcastToRoom(this.userRooms[userId], {
                        type: 'screen_share',
                        senderId: userId,
                        screenSharing: isScreenSharing
                    });
                    break;
            case 'chat_message':
                if (this.mutedUsers.has(userId)) break;
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'chat_message',
                    senderId: userId,
                    message: this.sanitize(data.message),
                }, userId);
                break;

            case 'file_meta':
                if (this.mutedUsers.has(userId)) break;
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'file_meta',
                    userId,
                    fileName: this.sanitize(data.fileName),
                    fileSize: data.fileSize,
                }, userId);
                break;

            case 'raise_hand':
                const isRaised = data.isRaised;
                if (isRaised) {
                    this.handRaisedUsers.add(userId);
                } else {
                    this.handRaisedUsers.delete(userId);
                }
                
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'hand_raised',
                    userId,
                    isRaised
                });
                break;
            case 'start_recording':
                this.recordingUsers.add(userId);
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'recording_started',
                    userId
                });
                break;
                
            case 'stop_recording':
                this.recordingUsers.delete(userId);
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'recording_stopped',
                    userId
                });
                break;
                
            case 'request_to_join':
                this.handleWaitingRoomRequest(userId, data.roomId, data.user);
                break;
                
            case 'admit_user':
                this.handleAdmitUser(data.roomId, data.userId);
                break;
                
            case 'end_meeting':
                this.handleEndMeeting(data.roomId);
                break;
                
            case 'heartbeat':
                // Just acknowledge heartbeat
                if (this.clients[userId]) {
                    this.clients[userId].isAlive = true;
                }
                break;
        }
    }

    handleJoin(userId, roomId) {
        if (!this.rooms[roomId]) this.rooms[roomId] = [];
        if (this.userRooms[userId] === roomId) {
            return; // already joined
        }

        // Get the websocket for this user
        const ws = this.clients[userId];
        if (!ws) {
            logger.error(`Cannot find websocket for user ${userId}`);
            return;
        }
    
        // NEW: Check if user is in waiting room first
        if (this.waitingRoomUsers[roomId] && this.waitingRoomUsers[roomId].includes(userId)) {
            // Remove from waiting room
            this.waitingRoomUsers[roomId] = this.waitingRoomUsers[roomId].filter(id => id !== userId);
        }
    
        this.roomActivity[roomId] = Date.now();

        // Notify the new user about existing peers
        this.rooms[roomId].forEach(peer => {
            ws.send(JSON.stringify({ type: 'new_peer', userId: peer.userId }));
            
            // NEW: Also inform about current states
            if (this.screenShareUsers.has(peer.userId)) {
                ws.send(JSON.stringify({ 
                    type: 'screen_share', 
                    senderId: peer.userId, 
                    screenSharing: true 
                }));
            }
            
            if (this.recordingUsers.has(peer.userId)) {
                ws.send(JSON.stringify({ 
                    type: 'recording_started', 
                    userId: peer.userId
                }));
            }
            
            if (this.handRaisedUsers.has(peer.userId)) {
                ws.send(JSON.stringify({ 
                    type: 'hand_raised', 
                    userId: peer.userId,
                    isRaised: true
                }));
            }
        });
    
        // Notify existing peers about the new user
        this.rooms[roomId].forEach(peer => {
            peer.ws.send(JSON.stringify({ type: 'new_peer', userId }));
        });
    
        // Add the new user to the room
        this.rooms[roomId].push({ userId, ws });
        this.userRooms[userId] = roomId;
        this.userSockets.set(userId, ws);

        logger.info(`User ${userId} joined room ${roomId}`);
    }

    // Handle waiting room requests
handleWaitingRoomRequest(userId, roomId, user) {
    if (!this.waitingRoomUsers[roomId]) {
        this.waitingRoomUsers[roomId] = [];
    }
    
    this.waitingRoomUsers[roomId].push(userId);
    
    // Notify room admins about waiting user
    if (this.rooms[roomId]) {
        this.rooms[roomId].forEach(peer => {
            peer.ws.send(JSON.stringify({ 
                type: 'waiting_room_request', 
                user: { id: userId, ...user } 
            }));
        });
    }
    
    logger.info(`User ${userId} is waiting to join room ${roomId}`);
}

// Handle admitting users from waiting room
handleAdmitUser(roomId, userId) {
    const userSocket = this.clients[userId];
    if (userSocket) {
        // Notify the user they've been admitted
        userSocket.send(JSON.stringify({ type: 'user_admitted', userId }));
        
        // If they're in the waiting room, they'll join using the join message
        if (this.waitingRoomUsers[roomId]) {
            this.waitingRoomUsers[roomId] = this.waitingRoomUsers[roomId].filter(id => id !== userId);
        }
    }
}

// Handle ending a meeting
handleEndMeeting(roomId) {
    if (!this.rooms[roomId]) return;
    
    // Notify all users in the room
    this.rooms[roomId].forEach(peer => {
        peer.ws.send(JSON.stringify({ type: 'meeting_ended' }));
    });
    
    // Clean up the room
    this.rooms[roomId].forEach(peer => {
        delete this.userRooms[peer.userId];
    });
    
    delete this.rooms[roomId];
    delete this.waitingRoomUsers[roomId];
    delete this.roomActivity[roomId];
    logger.info(`Meeting ended in room ${roomId}`);
}

    // Relay targeted offer/answer/candidate
    relayMessage(senderId, targetUserId, data) {
        const targetSocket = this.clients[targetUserId];
        if (targetSocket) {
            data.senderId = senderId; // Important for the client to know the sender
            targetSocket.send(JSON.stringify(data));
            this.roomActivity[this.userRooms[senderId]] = Date.now();
        }
    }

    // Broadcast message to everyone in the room except optionally the sender
    broadcastToRoom(roomId, message, excludeUserId = null) {
        if (!this.rooms[roomId]) return;
        this.rooms[roomId].forEach(peer => {
            if (peer.userId !== excludeUserId) {
                peer.ws.send(JSON.stringify(message));
            }
        });
        this.roomActivity[roomId] = Date.now();
    }

    handleLeave(userId, roomId) {
        if (!this.rooms[roomId]) return;

        this.rooms[roomId] = this.rooms[roomId].filter(peer => peer.userId !== userId);
        this.broadcastToRoom(roomId, { type: 'peer_disconnect', userId });

        this.screenShareUsers.delete(userId);
        this.recordingUsers.delete(userId);
        this.handRaisedUsers.delete(userId);

        if (this.rooms[roomId].length === 0) {
            delete this.rooms[roomId];
            delete this.roomActivity[roomId];
        }

        delete this.userRooms[userId];
    }

    cleanupUser(userId) {
        if (!userId) return;
        
        const roomId = this.userRooms[userId];
        if (roomId) this.handleLeave(userId, roomId);
        
        // Also check waiting rooms
        for (const [roomId, users] of Object.entries(this.waitingRoomUsers)) {
            if (users.includes(userId)) {
                this.waitingRoomUsers[roomId] = users.filter(id => id !== userId);
            }
        }
        
        delete this.clients[userId];
        this.userSockets.delete(userId);
        this.screenShareUsers.delete(userId);
        this.recordingUsers.delete(userId);
        this.handRaisedUsers.delete(userId);

        logger.info(`Cleaned up user ${userId}`);
    }

    createValidators() {
        return {
            join: this.ajv.compile({
                type: 'object',
                properties: {
                    type: { const: 'join' },
                    roomId: { type: 'string' },
                    senderId: { type: 'string' }
                },
                required: ['type', 'roomId', 'senderId']
            }),
            offer: this.ajv.compile({
                type: 'object',
                properties: {
                    type: { const: 'offer' },
                    target: { type: 'string' },
                    sdp: { type: 'string' }
                },
                required: ['type', 'target', 'sdp']
            }),
            answer: this.ajv.compile({
                type: 'object',
                properties: {
                    type: { const: 'answer' },
                    target: { type: 'string' },
                    sdp: { type: 'string' }
                },
                required: ['type', 'target', 'sdp']
            }),
            candidate: this.ajv.compile({
                type: 'object',
                properties: {
                    type: { const: 'candidate' },
                    target: { type: 'string' },
                    candidate: { type: 'string' }
                },
                required: ['type', 'target', 'candidate']
            }),
            chat_message: this.ajv.compile({
                type: 'object',
                properties: {
                    type: { const: 'chat_message' },
                    message: { type: 'string' }
                },
                required: ['type', 'message']
            }),
            file_meta: this.ajv.compile({
                type: 'object',
                properties: {
                    type: { const: 'file_meta' },
                    fileName: { type: 'string' },
                    fileSize: { type: 'number' }
                },
                required: ['type', 'fileName', 'fileSize']
            })
        };
    }

    validateMessage(data) {
        const validator = this.validators[data.type];
        return validator ? validator(data) : true;
    }

    sanitize(str = '') {
        return String(str).replace(/[<>]/g, '');
    }

    startRoomCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [roomId, ts] of Object.entries(this.roomActivity)) {
                if (this.rooms[roomId] && this.rooms[roomId].length === 0 && now - ts > 3600000) {
                    delete this.rooms[roomId];
                    delete this.roomActivity[roomId];
                    delete this.waitingRoomUsers[roomId];
                    logger.info(`Cleaned up empty room ${roomId}`);
                }
            }
        }, 600000); // every 10 minutes
    }
}

module.exports = SignalingServer;
