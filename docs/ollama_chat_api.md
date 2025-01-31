# Ollama and Chat API Documentation

This document describes the REST API endpoints for Ollama AI integration and real-time chat functionality.

## Table of Contents
- [Ollama REST API](#ollama-rest-api)
- [Chat WebSocket API](#chat-websocket-api)
- [Authentication](#authentication)

## Ollama REST API

The Ollama integration provides two REST endpoints for direct AI interaction.

### Generate AI Response

```http
POST /api/ollama/generate
Content-Type: application/json

{
    "prompt": "Your question or prompt here",
    "context": "Optional context for the conversation"
}
```

**Parameters:**
- `prompt` (required): The text prompt to send to the AI model
- `context` (optional): Additional context to help guide the AI's response

**Response:**
```json
{
    "response": "AI-generated response text"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/ollama/generate \
     -H "Content-Type: application/json" \
     -d '{"prompt": "What is machine learning?"}'
```

### Check Model Status

```http
GET /api/ollama/status
```

**Response:**
```json
{
    "initialized": true,
    "model": "deepseek-r1-distill-qwen-7b",
    "modelPresent": true
}
```

## Chat WebSocket API

The chat functionality uses Socket.IO for real-time communication.

### Connection

```javascript
const socket = io('http://localhost:3000', {
    auth: {
        token: 'your-jwt-token'
    }
});
```

### Events

#### Private Messages

**Send a private message:**
```javascript
socket.emit('privateMessage', {
    recipientId: 'user123',
    message: 'Hello!'  // Use "/ai" prefix to trigger AI responses
});
```

**Receive private messages:**
```javascript
socket.on('privateMessage', (message) => {
    console.log(message);
    // {
    //     from: 'sender123',
    //     to: 'user123',
    //     text: 'Hello!',
    //     timestamp: '2025-01-31T12:00:00.000Z'
    // }
});
```

#### Group Messages

**Join a group:**
```javascript
socket.emit('createOrJoinGroup', {
    groupName: 'my-group'
});
```

**Send a group message:**
```javascript
socket.emit('groupMessage', {
    groupName: 'my-group',
    message: 'Hello group!'  // Use "/ai" prefix to trigger AI responses
});
```

**Receive group messages:**
```javascript
socket.on('groupMessage', (message) => {
    console.log(message);
    // {
    //     senderId: 'user123',
    //     message: 'Hello group!',
    //     timestamp: '2025-01-31T12:00:00.000Z'
    // }
});
```

### AI Integration

To interact with the AI in chats, prefix your message with "/ai":

```javascript
// Private AI chat
socket.emit('privateMessage', {
    recipientId: 'user123',
    message: '/ai What is the capital of France?'
});

// Group AI chat
socket.emit('groupMessage', {
    groupName: 'my-group',
    message: '/ai Explain quantum computing'
});
```

The AI response will be automatically sent back through the same channel (private or group) with "AI_Assistant" as the sender.

## Authentication

All endpoints require JWT authentication.

**Headers:**
```http
Authorization: Bearer <your-jwt-token>
```

**WebSocket Authentication:**
Provide the JWT token in the Socket.IO connection options:
```javascript
const socket = io('http://localhost:3000', {
    auth: {
        token: 'your-jwt-token'
    }
});
```

## Error Handling

### REST API Errors

```json
{
    "error": "Error message description"
}
```

### WebSocket Errors

```javascript
socket.on('error', (error) => {
    console.error('Error:', error);
});
```

## Examples

### Using the REST API with curl

```bash
# Generate AI Response
curl -X POST http://localhost:3000/api/ollama/generate \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your-token-here" \
     -d '{"prompt": "Explain how REST APIs work"}'

# Check Model Status
curl -X GET http://localhost:3000/api/ollama/status \
     -H "Authorization: Bearer your-token-here"
```

### Using the Chat API with JavaScript

```javascript
const socket = io('http://localhost:3000', {
    auth: { token: 'your-jwt-token' }
});

// Send a regular chat message
socket.emit('privateMessage', {
    recipientId: 'user123',
    message: 'Hello!'
});

// Send an AI query
socket.emit('privateMessage', {
    recipientId: 'user123',
    message: '/ai What is the meaning of life?'
});

// Listen for responses
socket.on('privateMessage', (message) => {
    if (message.from === 'AI_Assistant') {
        console.log('AI Response:', message.text);
    } else {
        console.log(`Message from ${message.from}:`, message.text);
    }
});
```

## Rate Limiting

- REST API endpoints are rate-limited to prevent abuse
- WebSocket connections have built-in flood protection

## Notes

1. The AI model (DeepSeek-R1-Distill-Qwen-7B) is loaded on server startup
2. AI responses are automatically saved to the database
3. Offline users will receive messages when they reconnect
4. All timestamps are in ISO 8601 format
