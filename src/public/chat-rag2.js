// Include this in your HTML before initializing the widget
// <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
// <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

class ChatWidget {
    constructor(config = {}) {
      this.websocketUrl = config.websocketUrl || 'http://localhost:3007'; // Note: http, not ws://
      this.position = config.position || 'bottom-right';  
      this.persona = config.persona || 'AI_Assistant';
      this.service = config.service || 'chatbot-rag';   
      this.theme = {
        primary: config.theme?.primary || '#4A6FFF',
        secondary: config.theme?.secondary || '#f0f4f9',
        text: config.theme?.text || '#333333',
        lightText: config.theme?.lightText || '#6E7A8A',
        border: config.theme?.border || '#E1E8ED'
      };
      this.authToken = config.authToken;
      
      this.socket = null;
      this.isOpen = false;
      this.isMaximized = false;
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
          transition: all 0.3s ease-in-out;
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
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          align-self: flex-end;
          transition: transform 0.2s ease;
        }
        
        .chat-widget-button:hover {
          transform: scale(1.05);
        }
  
        .chat-widget {
          display: none;
          width: 350px;
          height: 500px;
          background: white;
          border-radius: 16px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          margin-bottom: 20px;
          flex-direction: column;
          overflow: hidden;
          transition: all 0.3s ease;
          border: 1px solid ${this.theme.border};
        }
        
        .chat-widget.maximized {
          width: 80%;
          max-width: 1200px;
          height: 80vh;
          max-height: 800px;
          position: fixed;
          left: 10%; /* Position from left instead of transform for better control */
          bottom: 100px;
          margin-bottom: 0;
        }
  
        .chat-widget.open {
          display: flex;
          animation: slideUp 0.3s forwards;
        }
        
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
  
        .chat-widget-header {
          padding: 16px 20px;
          background: ${this.theme.primary};
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 500;
        }
        
        .chat-widget-title {
          font-size: 16px;
        }
        
        .chat-controls {
          display: flex;
          gap: 10px;
        }
        
        .chat-control-button {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          transition: background-color 0.2s;
        }
        
        .chat-control-button:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }
  
        .chat-widget-messages {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background-color: #FBFCFD;
        }
        
        .chat-widget-messages::-webkit-scrollbar {
          width: 6px;
        }
        
        .chat-widget-messages::-webkit-scrollbar-track {
          background: #f1f1f1;
        }
        
        .chat-widget-messages::-webkit-scrollbar-thumb {
          background: #c1c1c1;
          border-radius: 6px;
        }
  
        .chat-message {
          max-width: 85%;
          padding: 12px 16px;
          border-radius: 18px;
          margin: 2px 0;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
          line-height: 1.5;
          font-size: 14px;
          animation: messageFade 0.3s forwards;
        }
        
        @keyframes messageFade {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
  
        .chat-message.user {
          background: ${this.theme.primary};
          color: white;
          align-self: flex-end;
          border-bottom-right-radius: 4px;
        }
  
        .chat-message.bot {
          background: white;
          color: ${this.theme.text};
          align-self: flex-start;
          border-bottom-left-radius: 4px;
          border: 1px solid ${this.theme.border};
        }
        
        .chat-message.bot a {
          color: ${this.theme.primary};
          text-decoration: none;
        }
        
        .chat-message.bot a:hover {
          text-decoration: underline;
        }
        
        .chat-message.bot p {
          margin: 0 0 10px 0;
        }
        
        .chat-message.bot p:last-child {
          margin-bottom: 0;
        }
        
        .chat-message.bot pre {
          background: #f5f7f9;
          padding: 10px;
          border-radius: 6px;
          overflow-x: auto;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
          font-size: 13px;
        }
        
        .chat-message.bot code {
          background: #f5f7f9;
          padding: 2px 5px;
          border-radius: 4px;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
          font-size: 13px;
        }
  
        .chat-widget-input {
          display: flex;
          padding: 16px;
          border-top: 1px solid ${this.theme.border};
          background: white;
        }
  
        .chat-widget-input input {
          flex: 1;
          padding: 12px 16px;
          border: 1px solid ${this.theme.border};
          border-radius: 24px;
          margin-right: 10px;
          font-size: 14px;
          transition: border-color 0.2s;
          outline: none;
        }
        
        .chat-widget-input input:focus {
          border-color: ${this.theme.primary};
          box-shadow: 0 0 0 2px rgba(74, 111, 255, 0.1);
        }
  
        .chat-widget-input button {
          padding: 10px 18px;
          background: ${this.theme.primary};
          color: white;
          border: none;
          border-radius: 24px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s, transform 0.1s;
        }
        
        .chat-widget-input button:hover {
          background: ${this.theme.primary}e0;
        }
        
        .chat-widget-input button:active {
          transform: scale(0.98);
        }
        
        .typing-indicator {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          background: white;
          border-radius: 16px;
          align-self: flex-start;
          margin-bottom: 8px;
          color: ${this.theme.lightText};
          font-size: 14px;
          border: 1px solid ${this.theme.border};
        }
        
        .typing-indicator .dots {
          display: flex;
          margin-left: 8px;
        }
        
        .typing-indicator .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: ${this.theme.lightText};
          margin-right: 3px;
          animation: typing-dot 1.4s infinite ease-in-out;
        }
        
        .typing-indicator .dot:nth-child(1) {
          animation-delay: 0s;
        }
        
        .typing-indicator .dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        
        .typing-indicator .dot:nth-child(3) {
          animation-delay: 0.4s;
          margin-right: 0;
        }
        
        @keyframes typing-dot {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `;
      document.head.appendChild(styles);
  
      const container = document.createElement('div');
      container.className = 'chat-widget-container';
      container.innerHTML = `
        <div class="chat-widget">
          <div class="chat-widget-header">
            <span class="chat-widget-title">Chat with us</span>
            <div class="chat-controls">
              <button class="chat-control-button maximize-button" title="Maximize chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <polyline points="9 21 3 21 3 15"></polyline>
                  <line x1="21" y1="3" x2="14" y2="10"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
              </button>
              <button class="chat-control-button minimize-button" style="display: none;" title="Minimize chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 14 10 14 10 20"></polyline>
                  <polyline points="20 10 14 10 14 4"></polyline>
                  <line x1="14" y1="10" x2="21" y2="3"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
              </button>
              <button class="chat-control-button close-button" title="Close chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
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
      const maximizeButton = container.querySelector('.maximize-button');
      const minimizeButton = container.querySelector('.minimize-button');
      const closeButton = container.querySelector('.close-button');
  
      toggleButton.addEventListener('click', () => this.toggle());
      sendButton.addEventListener('click', () => this.sendMessage());
      this.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendMessage();
      });
      
      maximizeButton.addEventListener('click', () => this.maximize());
      minimizeButton.addEventListener('click', () => this.minimize());
      closeButton.addEventListener('click', () => this.toggle());
  
      this.connectWebSocket();
      
      // Welcome message
      setTimeout(() => {
        if (this.isOpen) {
          this.addMessage("👋 Hi there! How can I help you today?", 'bot');
        }
      }, 1000);
    }
  
    toggle() {
      this.isOpen = !this.isOpen;
      this.widget.classList.toggle('open');
      
      // If closing, also ensure we minimize if maximized
      if (!this.isOpen && this.isMaximized) {
        this.minimize();
      }
      
      if (this.isOpen && !this.messagesContainer.hasChildNodes()) {
        this.addMessage("👋 Hi there! How can I help you today?", 'bot');
      }
    }
    
    maximize() {
      this.isMaximized = true;
      this.widget.classList.add('maximized');
      this.widget.querySelector('.maximize-button').style.display = 'none';
      this.widget.querySelector('.minimize-button').style.display = 'flex';
      
      // Center the widget in the viewport
      const windowHeight = window.innerHeight;
      const bottomPosition = 100; // Keep some space from bottom
      
      // Ensure the chat is visible and properly positioned
      setTimeout(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }, 300);
    }
    
    minimize() {
      this.isMaximized = false;
      this.widget.classList.remove('maximized');
      this.widget.querySelector('.maximize-button').style.display = 'flex';
      this.widget.querySelector('.minimize-button').style.display = 'none';
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
  
      this.socket.on(this.service, (data) => {
        this.removeTypingIndicator();
        const text = typeof data === 'string' ? data : data.text || '[message received]';
        this.addMessage(text, 'bot');
      });
  
      this.socket.on('info', (msg) => {
        this.removeTypingIndicator();
        this.addMessage(msg, 'bot');
      });
  
      this.socket.on('error', (err) => {
        this.removeTypingIndicator();
        console.error('Socket.IO error:', err);
        this.addMessage("Sorry, there was an error processing your request. Please try again later.", 'bot');
      });
  
      this.socket.on('disconnect', () => {
        console.log('Disconnected from chat server');
        setTimeout(() => this.connectWebSocket(), 5000); // retry
      });
    }
    
    addTypingIndicator() {
      const typingDiv = document.createElement('div');
      typingDiv.className = 'typing-indicator';
      typingDiv.innerHTML = `
        <span>AI is typing</span>
        <div class="dots">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
      `;
      typingDiv.id = 'typing-indicator';
      this.messagesContainer.appendChild(typingDiv);
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    removeTypingIndicator() {
      const typingIndicator = document.getElementById('typing-indicator');
      if (typingIndicator) {
        typingIndicator.remove();
      }
    }
  
    sendMessage() {
      let message = this.input.value.trim();
      if (!message) return;
  
      this.addMessage(message, 'user');
      this.addTypingIndicator();
      
      if(this.service !== 'chatbot' && this.service !== 'chatbot-rag' && this.service !== 'chat-bot') {
        console.log("Skipping sending message to socket");
        this.input.value = '';
        setTimeout(() => {
          this.removeTypingIndicator();
          this.addMessage("Please select a valid service: " + this.service, 'bot');
        }, 500);
        return;
      }
      
      if (this.socket && this.socket.connected) {
        this.socket.emit(this.service, {
          recipientId: this.persona,
          message
        });
      } else {
        setTimeout(() => {
          this.removeTypingIndicator();
          this.addMessage("Sorry, I'm not connected to the server right now. Please try again later.", 'bot');
        }, 1000);
      }
  
      this.input.value = '';
      this.input.focus();
    }
    
    addMessage(text, type) {
      const messageDiv = document.createElement('div');
      messageDiv.className = `chat-message ${type}`;
    
      if (type === 'bot' && window.marked) {
        try {
          messageDiv.innerHTML = marked.parse(text);
          
          // Make links open in new tab
          const links = messageDiv.querySelectorAll('a');
          links.forEach(link => {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
          });
        } catch (e) {
          messageDiv.textContent = text;
        }
      } else {
        messageDiv.textContent = text;
      }
    
      this.messagesContainer.appendChild(messageDiv);
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
  }
  
  // Make available globally
  window.ChatWidget = ChatWidget;