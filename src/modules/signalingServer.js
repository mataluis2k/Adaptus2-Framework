const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { getMyConfig } = require('./apiConfig'); // Adaptus2 API config

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';
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
        this.config = getMyConfig('signalingServer.json');
        this.setupWebSocket();
        this.startHeartbeat();
    }
    startHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('Terminating dead connection');
                    ws.terminate(); // This triggers `ws.on('close')` -> cleanupUser()
                    return;
                }
    
                ws.isAlive = false;
                ws.ping(); // Triggers client's pong
            });
        }, 30000); // Every 30 seconds
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log('New WebSocket connection');
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });

            const token = req.url.split('?token=')[1];
            if (!token) {
                ws.close(4001, 'Unauthorized');
                return;
            }

            const credentialsMap = this.config.credentialsObject;
            let userId;
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                userId = decoded[credentialsMap.userId];
                this.clients[userId] = ws;
            } catch (err) {
                console.error('JWT validation failed:', err);
                ws.close(4001, 'Invalid token');
                return;
            }

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'join') {
                        userId = data.senderId;
                        this.clients[userId] = ws;
                        this.handleJoin(userId, data.roomId);
                        ws.userId = userId; // <- Assign userId to ws for cleanup later
                    } else if (userId) {
                        this.handleMessage(userId, data);
                    }
                } catch (err) {
                    console.error('Failed to parse message:', err);
                }
            });
            ws.on('close', () => {
                const currentUserId = ws.userId;
                
                this.cleanupUser(currentUserId);
                if (!currentUserId) return;
                // Cleanup on disconnect
                for (const roomId in this.rooms) {
                    this.rooms[roomId] = this.rooms[roomId].filter(p => p.userId !== currentUserId);
                    this.rooms[roomId].forEach(peer => {
                        peer.ws.send(JSON.stringify({ type: 'peer_disconnect', userId: currentUserId }));
                    });
                    if (this.rooms[roomId].length === 0) delete this.rooms[roomId];
                }
                this.userSockets.delete(currentUserId);
                console.log(`User ${currentUserId} disconnected`);
            });
        });
    }

    handleMessage(userId, data) {
        console.log(`Received from ${userId}:`, data);
        

        switch (data.type) {
            case 'join':
                this.handleJoin(userId, data.roomId);
                break;

            case 'offer':
            case 'answer':
            case 'candidate':
                this.relayMessage(userId, data.target, data);
                break;
	        case 'leave':
                this.handleLeave(userId, data.roomId);
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
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'chat_message',
                    senderId: userId,
                    message: data.message,
                }, userId);
                break;

            case 'file_meta':
                this.broadcastToRoom(this.userRooms[userId], {
                    type: 'file_meta',
                    userId,
                    fileName: data.fileName,
                    fileSize: data.fileSize,
                }, userId);
                break;

            case 'leave':
                this.handleLeave(userId, this.userRooms[userId]);
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
                ws.isAlive = true;
                break;
        }
    }

    handleJoin(userId, roomId, ws) {
        if (!this.rooms[roomId]) this.rooms[roomId] = [];
    
        // NEW: Check if user is in waiting room first
        if (this.waitingRoomUsers[roomId] && this.waitingRoomUsers[roomId].includes(userId)) {
            // Remove from waiting room
            this.waitingRoomUsers[roomId] = this.waitingRoomUsers[roomId].filter(id => id !== userId);
        }
    
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
    
        console.log(`User ${userId} joined room ${roomId}`);
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
    
    console.log(`User ${userId} is waiting to join room ${roomId}`);
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
    console.log(`Meeting ended in room ${roomId}`);
}

// Handle user leaving a room
handleLeave(userId, roomId) {
    if (!this.rooms[roomId]) return;

    // Remove user from the room
    this.rooms[roomId] = this.rooms[roomId].filter(peer => peer.userId !== userId);

    // Notify others
    this.broadcastToRoom(roomId, { type: 'peer_disconnect', userId });

    // Clean up any states for the user
    this.screenShareUsers.delete(userId);
    this.recordingUsers.delete(userId);
    this.handRaisedUsers.delete(userId);

    if (this.rooms[roomId].length === 0) {
        delete this.rooms[roomId];
    }

    delete this.userRooms[userId];
}

    // Relay targeted offer/answer/candidate
    relayMessage(senderId, targetUserId, data) {
        const targetSocket = this.clients[targetUserId];
        if (targetSocket) {
            data.senderId = senderId; // Important for the client to know the sender
            targetSocket.send(JSON.stringify(data));
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
    }

    handleLeave(userId, roomId) {
        if (!this.rooms[roomId]) return;

        // Remove user from the room
        this.rooms[roomId] = this.rooms[roomId].filter(peer => peer.userId !== userId);

        // Notify others
        this.broadcastToRoom(roomId, { type: 'peer_disconnect', userId });

        if (this.rooms[roomId].length === 0) {
            delete this.rooms[roomId];
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
        
        console.log(`Cleaned up user ${userId}`);
    }
}

module.exports = SignalingServer;
