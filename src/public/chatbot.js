// Include this in your HTML before initializing the widget
// <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>

class ChatWidget {
  constructor(config = {}) {
    this.websocketUrl = config.websocketUrl || 'http://localhost:3007'; // Note: http, not ws://
    this.position = config.position || 'bottom-right';
    this.theme = {
      primary: config.theme?.primary || '#007bff',
      secondary: config.theme?.secondary || '#e9ecef',
      text: config.theme?.text || '#212529'
    };
    this.authToken = config.authToken;
    
    this.socket = null;
    this.isOpen = false;
    this.initialize();
  }

  initialize() {
    const styles = document.createElement('style');
    styles.textContent = `
      .chat-widget-container {
        position: fixed;
        ${this.position.includes('bottom') ? 'bottom: 20px;' : 'top: 20px;'}
        ${this.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
        z-index: 1000;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      }

      .chat-widget-button {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: ${this.theme.primary};
        color: white;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 12px rgba(0,0,0,0.1);
        align-self: flex-end;
      }

      .chat-widget {
        display: none;
        width: 350px;
        height: 500px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 5px 20px rgba(0,0,0,0.15);
        margin-bottom: 20px;
        flex-direction: column;
      }

      .chat-widget.open {
        display: flex;
      }

      .chat-widget-header {
        padding: 15px;
        background: ${this.theme.primary};
        color: white;
        border-radius: 12px 12px 0 0;
      }

      .chat-widget-messages {
        flex: 1;
        padding: 15px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .chat-message {
        max-width: 80%;
        padding: 10px 15px;
        border-radius: 15px;
        margin: 5px 0;
      }

      .chat-message.user {
        background: ${this.theme.primary};
        color: white;
        align-self: flex-end;
        border-bottom-right-radius: 5px;
      }

      .chat-message.bot {
        background: ${this.theme.secondary};
        color: ${this.theme.text};
        align-self: flex-start;
        border-bottom-left-radius: 5px;
      }

      .chat-widget-input {
        display: flex;
        padding: 15px;
        border-top: 1px solid #eee;
      }

      .chat-widget-input input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 20px;
        margin-right: 10px;
      }

      .chat-widget-input button {
        padding: 8px 15px;
        background: ${this.theme.primary};
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(styles);

    const container = document.createElement('div');
    container.className = 'chat-widget-container';
    container.innerHTML = `
      <div class="chat-widget">
        <div class="chat-widget-header">Chat with us</div>
        <div class="chat-widget-messages"></div>
        <div class="chat-widget-input">
          <input type="text" placeholder="Type your message...">
          <button>Send</button>
        </div>
      </div>
      <button class="chat-widget-button">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
    `;
    document.body.appendChild(container);

    this.widget = container.querySelector('.chat-widget');
    this.messagesContainer = container.querySelector('.chat-widget-messages');
    this.input = container.querySelector('input');
    const toggleButton = container.querySelector('.chat-widget-button');
    const sendButton = container.querySelector('.chat-widget-input button');

    toggleButton.addEventListener('click', () => this.toggle());
    sendButton.addEventListener('click', () => this.sendMessage());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    this.connectWebSocket();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.widget.classList.toggle('open');
  }

  connectWebSocket() {
    if (!window.io) {
      console.error('Socket.IO client not found. Make sure to load it via <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>');
      return;
    }

    this.socket = io(this.websocketUrl, {
      auth: {
        token: this.authToken
      },
      transports: ['websocket']
    });

    this.socket.on('connect', () => {
      console.log('Connected to chat server');
    });

    this.socket.on('privateMessage', (data) => {
      const text = typeof data === 'string' ? data : data.text || '[message received]';
      this.addMessage(text, 'bot');
    });

    this.socket.on('info', (msg) => {
      this.addMessage(msg, 'bot');
    });

    this.socket.on('error', (err) => {
      console.error('Socket.IO error:', err);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from chat server');
      setTimeout(() => this.connectWebSocket(), 5000); // retry
    });
  }

  sendMessage() {
    const message = this.input.value.trim();
    if (!message) return;

    this.addMessage(message, 'user');

    if (this.socket && this.socket.connected) {
      this.socket.emit('privateMessage', {
        recipientId: 'AI_Assistant',
        message
      });
    }

    this.input.value = '';
  }

  addMessage(text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}`;
    messageDiv.textContent = text;
    this.messagesContainer.appendChild(messageDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}

// Make available globally
window.ChatWidget = ChatWidget;
