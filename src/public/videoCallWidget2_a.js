class VideoCallWidget {
    constructor(config = {}) {
        this.websocketUrl = config.websocketUrl || 'wss://yourserver.com';
        this.roomId = config.roomId || 'default-room';
        this.userId = config.userId || 'user-' + Math.random().toString(36).substr(2, 9);
        this.authToken = config.authToken;
        this.socket = null;
        this.peerConnections = {};
        this.dataChannels = {};
        this.isScreenSharing = false;
        this.receivedFile = null;
        this.isCollapsed = false;
        this.isLocalVideoMuted = false;
        this.isLocalAudioMuted = false;
        this.localStream = null;
        this.screenStream = null;
        this.fileChunks = [];
        this.fileMetadata = null;
        this.participants = {};
        this.isCallActive = false;
	    this.isFullScreen = false;
	    this.isGalleryView = false;
	    this.focusedParticipant = null;
        this.initialize();
        this.isPolite = true; // Example, make dynamic per your use case
    }

    initialize() {
        this.createUI();
        this.createViewControls();
        this.setupMediaDevices();
        this.connectWebSocket();
    }

    async setupMediaDevices() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });
            this.localVideo.srcObject = this.localStream;
            this.updateParticipantCount();
        } catch (error) {
            this.showNotification('Camera/Microphone access denied', 'error');
            console.error('Error accessing media devices:', error);
        }
    }

    createUI() {
        // Main container
        this.mainContainer = document.createElement('div');
        this.mainContainer.className = 'video-call-widget';
        this.mainContainer.style.position = 'fixed';
        this.mainContainer.style.bottom = '20px';
        this.mainContainer.style.right = '20px';
        this.mainContainer.style.maxWidth = '350px';
        this.mainContainer.style.width = '350px';
        this.mainContainer.style.backgroundColor = '#fff';
        this.mainContainer.style.borderRadius = '12px';
        this.mainContainer.style.boxShadow = '0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)';
        this.mainContainer.style.overflow = 'hidden';
        this.mainContainer.style.transition = 'all 0.3s ease';
        this.mainContainer.style.zIndex = '9999';
        this.mainContainer.style.fontFamily = 'Arial, sans-serif';

        // Header
        this.header = document.createElement('div');
        this.header.className = 'widget-header';
        this.header.style.padding = '12px 15px';
        this.header.style.backgroundColor = '#4a69bd';
        this.header.style.color = 'white';
        this.header.style.display = 'flex';
        this.header.style.justifyContent = 'space-between';
        this.header.style.alignItems = 'center';
        this.header.style.cursor = 'pointer';

        // Header title with participant count
        this.headerTitle = document.createElement('div');
        this.headerTitle.style.display = 'flex';
        this.headerTitle.style.alignItems = 'center';
        this.headerTitle.style.gap = '8px';
        
        this.titleText = document.createElement('span');
        this.titleText.textContent = 'Video Call';
        this.titleText.style.fontWeight = 'bold';
        
        this.participantCounter = document.createElement('span');
        this.participantCounter.className = 'participant-count';
        this.participantCounter.style.backgroundColor = 'rgba(255,255,255,0.2)';
        this.participantCounter.style.borderRadius = '12px';
        this.participantCounter.style.padding = '2px 8px';
        this.participantCounter.style.fontSize = '12px';
        this.participantCounter.textContent = '1';
        
        this.headerTitle.appendChild(this.titleText);
        this.headerTitle.appendChild(this.participantCounter);

        // Header controls
        this.headerControls = document.createElement('div');
        this.headerControls.style.display = 'flex';
        this.headerControls.style.gap = '8px';
        
        this.collapseButton = document.createElement('button');
        this.collapseButton.className = 'icon-button';
        this.collapseButton.innerHTML = '−';
        this.collapseButton.style.background = 'none';
        this.collapseButton.style.border = 'none';
        this.collapseButton.style.color = 'white';
        this.collapseButton.style.fontSize = '18px';
        this.collapseButton.style.cursor = 'pointer';
        this.collapseButton.style.width = '24px';
        this.collapseButton.style.height = '24px';
        this.collapseButton.style.padding = '0';
        this.collapseButton.style.display = 'flex';
        this.collapseButton.style.justifyContent = 'center';
        this.collapseButton.style.alignItems = 'center';
        this.collapseButton.style.borderRadius = '50%';
        this.collapseButton.style.transition = 'background-color 0.2s';
        this.collapseButton.title = 'Collapse';
        
        this.collapseButton.addEventListener('mouseenter', () => {
            this.collapseButton.style.backgroundColor = 'rgba(255,255,255,0.2)';
        });
        
        this.collapseButton.addEventListener('mouseleave', () => {
            this.collapseButton.style.backgroundColor = 'transparent';
        });
        
        this.headerControls.appendChild(this.collapseButton);
        
        this.header.appendChild(this.headerTitle);
        this.header.appendChild(this.headerControls);
        
        // Make header clickable for collapse/expand
        this.header.addEventListener('click', (e) => {
            // Only toggle if clicking on the header itself, not on any controls
            if (e.target === this.header || e.target === this.titleText || e.target === this.headerTitle) {
                this.toggleCollapse();
            }
        });
        
        this.collapseButton.addEventListener('click', () => this.toggleCollapse());

        // Body container
        this.bodyContainer = document.createElement('div');
        this.bodyContainer.className = 'widget-body';
        this.bodyContainer.style.transition = 'height 0.3s ease';

        // Video container
        this.videoContainer = document.createElement('div');
        this.videoContainer.className = 'video-container';
        this.videoContainer.style.position = 'relative';
        this.videoContainer.style.backgroundColor = '#1e272e';
        this.videoContainer.style.height = '196px';
        this.videoContainer.style.overflow = 'hidden';

        // Local video
        this.localVideo = document.createElement('video');
        this.localVideo.autoplay = true;
        this.localVideo.muted = true;
        this.localVideo.style.width = '100%';
        this.localVideo.style.height = '100%';
        this.localVideo.style.objectFit = 'cover';
        
        // Video overlay for displaying participant names
        this.videoOverlay = document.createElement('div');
        this.videoOverlay.className = 'video-overlay';
        this.videoOverlay.style.position = 'absolute';
        this.videoOverlay.style.bottom = '10px';
        this.videoOverlay.style.left = '10px';
        this.videoOverlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.videoOverlay.style.color = 'white';
        this.videoOverlay.style.padding = '3px 8px';
        this.videoOverlay.style.borderRadius = '4px';
        this.videoOverlay.style.fontSize = '12px';
        this.videoOverlay.textContent = 'You';

        // Remote videos container
        this.remoteVideosContainer = document.createElement('div');
        this.remoteVideosContainer.className = 'remote-videos';
        this.remoteVideosContainer.style.display = 'flex';
        this.remoteVideosContainer.style.flexWrap = 'wrap';
        this.remoteVideosContainer.style.gap = '5px';
        this.remoteVideosContainer.style.padding = '5px';
        this.remoteVideosContainer.style.maxHeight = '150px';
        this.remoteVideosContainer.style.overflowY = 'auto';
        this.remoteVideosContainer.style.backgroundColor = '#f1f2f6';

        // Controls container
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = 'call-controls';
        this.controlsContainer.style.display = 'flex';
        this.controlsContainer.style.justifyContent = 'space-around';
        this.controlsContainer.style.padding = '10px 0';
        this.controlsContainer.style.borderTop = '1px solid #eee';
        this.controlsContainer.style.backgroundColor = '#f9f9f9';

        // Control buttons
        const controlButtons = [
            { icon: '🎤', action: () => this.toggleAudio(), tooltip: 'Toggle Audio', id: 'audioBtn' },
            { icon: '📹', action: () => this.toggleVideo(), tooltip: 'Toggle Video', id: 'videoBtn' },
            { icon: '🖥️', action: () => this.toggleScreenShare(), tooltip: 'Share Screen', id: 'screenBtn' },
            { icon: '📎', action: () => this.fileInput.click(), tooltip: 'Send File', id: 'fileBtn' },
            { icon: '💬', action: () => this.toggleChat(), tooltip: 'Chat', id: 'chatBtn' }
        ];

        controlButtons.forEach(btn => {
            const button = document.createElement('button');
            button.id = btn.id;
            button.className = 'control-button';
            button.innerHTML = btn.icon;
            button.title = btn.tooltip;
            button.style.width = '36px';
            button.style.height = '36px';
            button.style.borderRadius = '50%';
            button.style.border = 'none';
            button.style.backgroundColor = '#e0e0e0';
            button.style.cursor = 'pointer';
            button.style.transition = 'all 0.2s';
            button.style.display = 'flex';
            button.style.justifyContent = 'center';
            button.style.alignItems = 'center';
            button.style.fontSize = '16px';
            
            button.addEventListener('mouseenter', () => {
                button.style.backgroundColor = '#d0d0d0';
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.backgroundColor = '#e0e0e0';
            });
            
            button.addEventListener('click', btn.action);
            this.controlsContainer[btn.id] = button;
            this.controlsContainer.appendChild(button);
        });

        // File input (hidden)
        this.fileInput = document.createElement('input');
        this.fileInput.type = "file";
        this.fileInput.style.display = "none";
        this.fileInput.addEventListener('change', () => this.sendFile());

        // Chat container
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = 'chat-container';
        this.chatContainer.style.height = '200px';
        this.chatContainer.style.borderTop = '1px solid #eee';
        this.chatContainer.style.display = 'flex';
        this.chatContainer.style.flexDirection = 'column';
        
        // Chat messages
        this.chatMessages = document.createElement('div');
        this.chatMessages.className = 'chat-messages';
        this.chatMessages.style.height = '160px';
        this.chatMessages.style.overflowY = 'auto';
        this.chatMessages.style.padding = '10px';
        this.chatMessages.style.backgroundColor = '#f9f9f9';
        
        // Chat input container
        this.chatInputContainer = document.createElement('div');
        this.chatInputContainer.className = 'chat-input-container';
        this.chatInputContainer.style.paddingBottom = '15px';
        this.chatInputContainer.style.display = 'flex';
        this.chatInputContainer.style.padding = '10px';
        this.chatInputContainer.style.borderTop = '1px solid #eee';
        this.chatInputContainer.style.paddingBottom = '15px';  // Increased bottom padding        
        this.chatInputContainer.style.marginBottom = '10px';
        this.chatInputContainer.style.zIndex = '5';
        this.chatContainer.style.height = '220px';  // Increased from 200px
        
        // Chat input
        this.chatInput = document.createElement('input');
        this.chatInput.type = 'text';
        this.chatInput.placeholder = 'Type a message...';
        this.chatInput.className = 'chat-input';
        this.chatInput.style.flex = '1';
        this.chatInput.style.padding = '8px';
        this.chatInput.style.border = '1px solid #ddd';
        this.chatInput.style.borderRadius = '18px';
        this.chatInput.style.outline = 'none';
        
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Chat send button
        this.chatSendButton = document.createElement('button');
        this.chatSendButton.className = 'chat-send-button';
        this.chatSendButton.innerHTML = '➤';
        this.chatSendButton.style.marginLeft = '8px';
        this.chatSendButton.style.width = '36px';
        this.chatSendButton.style.height = '36px';
        this.chatSendButton.style.backgroundColor = '#4a69bd';
        this.chatSendButton.style.color = 'white';
        this.chatSendButton.style.border = 'none';
        this.chatSendButton.style.borderRadius = '50%';
        this.chatSendButton.style.cursor = 'pointer';
        
        this.chatSendButton.addEventListener('click', () => this.sendMessage());
        
        // Notification container
        this.notificationContainer = document.createElement('div');
        this.notificationContainer.className = 'notification-container';
        this.notificationContainer.style.position = 'absolute';
        this.notificationContainer.style.top = '60px';
        this.notificationContainer.style.left = '50%';
        this.notificationContainer.style.transform = 'translateX(-50%)';
        this.notificationContainer.style.zIndex = '1000';
        this.notificationContainer.style.width = '80%';
        
        // Room info container
        this.roomInfoContainer = document.createElement('div');
        this.roomInfoContainer.className = 'room-info';
        this.roomInfoContainer.style.padding = '10px';
        this.roomInfoContainer.style.backgroundColor = '#f0f0f0';
        this.roomInfoContainer.style.borderBottom = '1px solid #ddd';
        this.roomInfoContainer.style.fontSize = '14px';
        this.roomInfoContainer.textContent = `Room: ${this.roomId}`;

        // Append elements to their containers
        this.chatInputContainer.appendChild(this.chatInput);
        this.chatInputContainer.appendChild(this.chatSendButton);
        
        this.chatContainer.appendChild(this.chatMessages);
        this.chatContainer.appendChild(this.chatInputContainer);
        
        this.videoContainer.appendChild(this.localVideo);
        this.videoContainer.appendChild(this.videoOverlay);
        this.videoContainer.appendChild(this.notificationContainer);
        
        this.bodyContainer.appendChild(this.roomInfoContainer);
        this.bodyContainer.appendChild(this.videoContainer);
        this.bodyContainer.appendChild(this.remoteVideosContainer);
        this.bodyContainer.appendChild(this.controlsContainer);
        this.bodyContainer.appendChild(this.chatContainer);
        this.bodyContainer.style.maxHeight = '700px';
        
        this.mainContainer.appendChild(this.header);
        this.mainContainer.appendChild(this.bodyContainer);
        
        document.body.appendChild(this.mainContainer);
        document.body.appendChild(this.fileInput);
    }
// Create additional UI elements for fullscreen & gallery view
createViewControls() {
    // Fullscreen button
    this.fullscreenButton = document.createElement('button');
    this.fullscreenButton.className = 'view-control-button';
    this.fullscreenButton.innerHTML = '⛶';
    this.fullscreenButton.title = 'Toggle Fullscreen';
    this.fullscreenButton.style.position = 'absolute';
    this.fullscreenButton.style.top = '10px';
    this.fullscreenButton.style.right = '10px';
    this.fullscreenButton.style.zIndex = '10';
    this.fullscreenButton.style.backgroundColor = 'rgba(0,0,0,0.5)';
    this.fullscreenButton.style.color = 'white';
    this.fullscreenButton.style.border = 'none';
    this.fullscreenButton.style.borderRadius = '50%';
    this.fullscreenButton.style.width = '36px';
    this.fullscreenButton.style.height = '36px';
    this.fullscreenButton.style.cursor = 'pointer';
    this.fullscreenButton.style.display = 'flex';
    this.fullscreenButton.style.justifyContent = 'center';
    this.fullscreenButton.style.alignItems = 'center';
    this.fullscreenButton.style.fontSize = '18px';
    this.fullscreenButton.addEventListener('click', () => this.toggleFullScreen());
    
    // Gallery view toggle
    this.galleryViewButton = document.createElement('button');
    this.galleryViewButton.className = 'view-control-button';
    this.galleryViewButton.innerHTML = '◫';
    this.galleryViewButton.title = 'Toggle Gallery View';
    this.galleryViewButton.style.position = 'absolute';
    this.galleryViewButton.style.top = '10px';
    this.galleryViewButton.style.right = '56px';
    this.galleryViewButton.style.zIndex = '10';
    this.galleryViewButton.style.backgroundColor = 'rgba(0,0,0,0.5)';
    this.galleryViewButton.style.color = 'white';
    this.galleryViewButton.style.border = 'none';
    this.galleryViewButton.style.borderRadius = '50%';
    this.galleryViewButton.style.width = '36px';
    this.galleryViewButton.style.height = '36px';
    this.galleryViewButton.style.cursor = 'pointer';
    this.galleryViewButton.style.display = 'flex';
    this.galleryViewButton.style.justifyContent = 'center';
    this.galleryViewButton.style.alignItems = 'center';
    this.galleryViewButton.style.fontSize = '18px';
    this.galleryViewButton.addEventListener('click', () => this.toggleGalleryView());
    
    // Add to video container
    this.videoContainer.appendChild(this.fullscreenButton);
    this.videoContainer.appendChild(this.galleryViewButton);
}

    // Create a gallery view item for a participant
createGalleryItem(id, name, stream) {
    const container = document.createElement('div');
    container.className = 'gallery-item';
    container.dataset.id = id;
    container.style.position = 'relative';
    container.style.backgroundColor = '#1e272e';
    container.style.borderRadius = '8px';
    container.style.overflow = 'hidden';
    container.style.cursor = 'pointer';
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = id ===  this.userId; // Only mute self
    video.srcObject = stream;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    
    const nameLabel = document.createElement('div');
    nameLabel.textContent = name;
    nameLabel.style.position = 'absolute';
    nameLabel.style.bottom = '10px';
    nameLabel.style.left = '10px';
    nameLabel.style.backgroundColor = 'rgba(0,0,0,0.5)';
    nameLabel.style.color = 'white';
    nameLabel.style.padding = '5px 8px';
    nameLabel.style.borderRadius = '4px';
    nameLabel.style.fontSize = '12px';
    
    const focusButton = document.createElement('button');
    focusButton.innerHTML = '👁️';
    focusButton.title = 'Focus on this participant';
    focusButton.style.position = 'absolute';
    focusButton.style.top = '10px';
    focusButton.style.right = '10px';
    focusButton.style.backgroundColor = 'rgba(0,0,0,0.5)';
    focusButton.style.color = 'white';
    focusButton.style.border = 'none';
    focusButton.style.borderRadius = '50%';
    focusButton.style.width = '30px';
    focusButton.style.height = '30px';
    focusButton.style.cursor = 'pointer';
    focusButton.style.display = 'flex';
    focusButton.style.justifyContent = 'center';
    focusButton.style.alignItems = 'center';
    
    // Click handler for focus
    focusButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.focusParticipant(id);
    });
    
    // Double click handler for the container to focus
    container.addEventListener('dblclick', () => {
        this.focusParticipant(id);
    });
    
    container.appendChild(video);
    container.appendChild(nameLabel);
    container.appendChild(focusButton);
    
    // Add a highlight if this is the focused participant
    if (this.focusedParticipant === id) {
        container.style.border = '3px solid #4a69bd';
        focusButton.innerHTML = '✓';
    }
    
    return container;
}

    // Focus on a specific participant
    focusParticipant(participantId) {
        if (this.focusedParticipant === participantId) {
            // Unfocus if clicking the same participant
            this.focusedParticipant = null;
            this.showNotification('Returned to default view');
        } else {
            this.focusedParticipant = participantId;
            this.showNotification(`Focused on ${participantId ===  this.userId ? 'yourself' : 'User ' + participantId}`);
        }
        
        // If in gallery view, stay there but highlight the focused user
        if (this.isGalleryView) {
            this.updateGalleryLayout();
        } else {
            // If in standard view, swap to focused participant
            this.isGalleryView = false;
            this.updateStandardLayout();
        }
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        
        if (this.isCollapsed) {
            this.bodyContainer.style.display = 'none';
            this.collapseButton.innerHTML = '+';
            this.collapseButton.title = 'Expand';
            // Minimize to just show the header
            this.mainContainer.style.width = '200px';
        } else {
            this.bodyContainer.style.display = 'block';
            this.collapseButton.innerHTML = '−';
            this.collapseButton.title = 'Collapse';
            this.mainContainer.style.width = '350px';
        }
    }

    toggleChat() {
        if (this.chatContainer.style.display === 'none') {
            this.chatContainer.style.display = 'block';
            this.controlsContainer.chatBtn.style.backgroundColor = '#4a69bd';
            this.controlsContainer.chatBtn.style.color = 'white';
        } else {
            this.chatContainer.style.display = 'none';
            this.controlsContainer.chatBtn.style.backgroundColor = '#e0e0e0';
            this.controlsContainer.chatBtn.style.color = 'black';
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.padding = '8px 12px';
        notification.style.marginBottom = '5px';
        notification.style.borderRadius = '4px';
        notification.style.color = 'white';
        notification.style.textAlign = 'center';
        notification.style.fontSize = '14px';
        notification.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        
        if (type === 'error') {
            notification.style.backgroundColor = '#e74c3c';
        } else if (type === 'success') {
            notification.style.backgroundColor = '#2ecc71';
        } else {
            notification.style.backgroundColor = '#3498db';
        }
        
        this.notificationContainer.appendChild(notification);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            this.notificationContainer.removeChild(notification);
        }, 3000);
    }

    connectWebSocket() {
        try {
            this.socket = new WebSocket(`${this.websocketUrl}?token=${this.authToken}`);
            
            this.socket.onopen = () => {
                this.showNotification('Connected to server', 'success');
                this.socket.send(JSON.stringify({ type: 'join', roomId: this.roomId, senderId: this.userId }));
            };
            
            this.socket.onclose = () => {
                this.showNotification('Disconnected from server', 'error');
            };
            
            this.socket.onerror = (error) => {
                this.showNotification('WebSocket connection error', 'error');
                console.error('WebSocket error:', error);
            };
            
            this.socket.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                switch (data.type) {
                    case 'new_peer':
                        this.handleNewPeer(data.userId);
                        break;
                    case 'offer':
                        this.handleOffer(data);
                        break;
                    case 'answer':
                        this.handleAnswer(data);
                        break;
                    case 'candidate':
                        this.handleIceCandidate(data);
                        break;
                    case 'chat_message':
                        this.receiveMessage(data);
                        break;
                    case 'file_chunk':
                        this.receiveFileChunk(data);
                        break;
                    case 'file_meta':
                        this.prepareForFileReception(data);
                        break;
                    case 'peer_disconnect':
                        this.handlePeerDisconnect(data.userId);
                        break;
                }
            };
        } catch (error) {
            this.showNotification('Failed to connect to server', 'error');
            console.error('WebSocket connection error:', error);
        }
    }
    handleNewPeer(peerId) {
        this.showNotification('New participant joined');
        this.addParticipant(peerId);
        
        // Add a small delay before creating the offer to ensure stable state
        setTimeout(() => {
            if (this.isPolite) {
                this.createOffer(peerId);
            }
        }, 100);
    }

    async handleOffer(data) {
        const peerId = data.senderId;

        if (!this.peerConnections[peerId]) {
            this.createPeerConnection(peerId);
        }
        const pc = this.peerConnections[peerId];

        console.log(`Handling offer from ${peerId}. Current state: ${pc.signalingState}`);

        const offerCollision = pc.signalingState !== "stable";
        const ignoreOffer = !this.isPolite && offerCollision;

        if (ignoreOffer) {
            console.warn(`Ignoring offer from ${peerId} due to collision`);
            return;
        }

        try {
            // If we have a local description and there's a collision, rollback
            if (offerCollision && pc.signalingState !== "have-remote-offer") {
                console.log(`Rolling back local description. Current state: ${pc.signalingState}`);
                await Promise.all([
                    pc.setLocalDescription({type: "rollback"}),
                    new Promise(resolve => setTimeout(resolve, 100)) // Small delay to ensure state update
                ]);
            }

            // Ensure we're in a valid state to set remote description
            if (pc.signalingState === "have-remote-offer") {
                console.log("Already have remote offer, rolling back");
                await pc.setLocalDescription({type: "rollback"});
                await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure state update
            }

            if (!["stable", "have-local-pranswer"].includes(pc.signalingState)) {
                console.warn(`Cannot handle offer in state: ${pc.signalingState}`);
                return;
            }

            console.log(`Setting remote description. Current state: ${pc.signalingState}`);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

            // Process any pending ICE candidates
            await this.addPendingIceCandidates(peerId);

            // Small delay to ensure remote description and ICE candidates are fully applied
            await new Promise(resolve => setTimeout(resolve, 100));

            console.log(`Creating answer. Current state: ${pc.signalingState}`);
            const answer = await pc.createAnswer();

            console.log(`Setting local description (answer). Current state: ${pc.signalingState}`);
            await pc.setLocalDescription(answer);

            // Wait for ICE gathering to complete
            await new Promise(resolve => {
                if (pc.iceGatheringState === "complete") {
                    resolve();
                } else {
                    pc.addEventListener("icegatheringstatechange", () => {
                        if (pc.iceGatheringState === "complete") {
                            resolve();
                        }
                    });
                }
            });

            this.socket.send(JSON.stringify({
                type: 'answer',
                target: peerId,
                senderId: this.userId,
                answer: pc.localDescription
            }));

            console.log(`Answer sent to ${peerId}. Final state: ${pc.signalingState}`);
        } catch (error) {
            console.error('Error handling offer:', error);
            this.showNotification('Failed to handle offer', 'error');

            if (error.name === 'InvalidStateError') {
                console.log("Attempting state recovery...");
                try {
                    // Reset the connection state
                    if (pc.signalingState !== "stable") {
                        await pc.setLocalDescription({type: "rollback"});
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    // Try the offer/answer exchange again
                    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    const newAnswer = await pc.createAnswer();
                    await pc.setLocalDescription(newAnswer);

                    // Wait for ICE gathering
                    await new Promise(resolve => {
                        if (pc.iceGatheringState === "complete") {
                            resolve();
                        } else {
                            pc.addEventListener("icegatheringstatechange", () => {
                                if (pc.iceGatheringState === "complete") {
                                    resolve();
                                }
                            });
                        }
                    });

                    this.socket.send(JSON.stringify({
                        type: 'answer',
                        target: peerId,
                        senderId: this.userId,
                        answer: pc.localDescription
                    }));

                    console.log("Successfully recovered from invalid state");
                } catch (recoveryError) {
                    console.error('Failed to recover from invalid state:', recoveryError);
                    // If recovery fails, we might need to recreate the peer connection
                    this.handlePeerDisconnect(peerId);
                    this.createPeerConnection(peerId);
                    this.createOffer(peerId);
                }
            }
        }
    }

    // Helper to create PeerConnection if missing
    createPeerConnection(peerId) {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        this.peerConnections[peerId] = pc;

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.send(JSON.stringify({
                    type: 'candidate',
                    target: peerId,
                    senderId: this.userId,
                    candidate: event.candidate
                }));
            }
        };

        pc.ontrack = (event) => {
            this.addParticipant(peerId);
            if (this.participants[peerId]) {
                this.participants[peerId].video.srcObject = event.streams[0];
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                this.showNotification('Connected to peer', 'success');
            } else if (['disconnected', 'failed'].includes(pc.connectionState)) {
                this.showNotification('Peer connection lost', 'error');
            }
        };

        pc.ondatachannel = (event) => {
            this.setupDataChannel(peerId, event.channel, event.channel.label);
        };
    }


    async handleAnswer(data) {
        const pc = this.peerConnections[data.senderId];
        if (!pc) {
            console.error('PeerConnection missing');
            return;
        }

        console.log(`Handling answer from ${data.senderId}. Current state: ${pc.signalingState}`);

        try {
            // Only proceed if we're in a valid state to receive an answer
            if (pc.signalingState !== "have-local-offer") {
                console.warn(`Cannot set answer in state: ${pc.signalingState}`);
                if (pc.signalingState === "have-remote-offer") {
                    // We're in a glare situation, both peers tried to send offers
                    if (this.isPolite) {
                        console.log("Polite peer rolling back in glare situation");
                        await pc.setLocalDescription({type: "rollback"});
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    } else {
                        console.log("Impolite peer ignoring answer in glare situation");
                        return;
                    }
                } else {
                    return;
                }
            } else {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                
                // Process any pending ICE candidates
                await this.addPendingIceCandidates(peerId);
            }

            console.log(`Answer processed successfully. Final state: ${pc.signalingState}`);
        } catch (error) {
            console.error('Error handling answer:', error);
            this.showNotification('Failed to set remote answer', 'error');
            
            if (error.name === 'InvalidStateError') {
                console.log("Attempting state recovery for answer...");
                try {
                    // Reset to stable state
                    if (pc.signalingState !== "stable") {
                        await pc.setLocalDescription({type: "rollback"});
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    // Try to establish the connection again
                    await this.createOffer(data.senderId);
                    console.log("Successfully initiated new connection after recovery");
                } catch (recoveryError) {
                    console.error('Failed to recover from invalid state:', recoveryError);
                    // If recovery fails, recreate the connection
                    this.handlePeerDisconnect(data.senderId);
                    this.createPeerConnection(data.senderId);
                    this.createOffer(data.senderId);
                }
            }
        }
    }
    
    

    // Store ICE candidates that arrive before remote description
    pendingIceCandidates = {};

    handleIceCandidate(data) {
        const peerId = data.senderId;
        const pc = this.peerConnections[peerId];
        
        if (!pc) {
            console.warn(`No peer connection for ${peerId} to handle ICE candidate`);
            return;
        }

        const candidate = new RTCIceCandidate(data.candidate);

        // Initialize pending candidates array for this peer if needed
        if (!this.pendingIceCandidates[peerId]) {
            this.pendingIceCandidates[peerId] = [];
        }

        // If we don't have a remote description yet, queue the candidate
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
            console.log(`Queueing ICE candidate for ${peerId} - no remote description yet`);
            this.pendingIceCandidates[peerId].push(candidate);
            return;
        }

        // Add the candidate if we have a remote description
        this.addIceCandidate(pc, candidate, peerId);
    }

    // Helper method to add ICE candidate with error handling
    async addIceCandidate(pc, candidate, peerId) {
        try {
            await pc.addIceCandidate(candidate);
            console.log(`ICE candidate added successfully for ${peerId}`);
        } catch (error) {
            console.error(`Error adding ICE candidate for ${peerId}:`, error);
            
            // If we get an invalid state error, queue the candidate
            if (error.name === 'InvalidStateError') {
                console.log(`Invalid state when adding ICE candidate for ${peerId}, queueing...`);
                if (!this.pendingIceCandidates[peerId]) {
                    this.pendingIceCandidates[peerId] = [];
                }
                this.pendingIceCandidates[peerId].push(candidate);
            }
        }
    }

    // Helper to add any pending ICE candidates after remote description is set
    async addPendingIceCandidates(peerId) {
        const pc = this.peerConnections[peerId];
        if (!pc || !this.pendingIceCandidates[peerId]) return;

        console.log(`Adding ${this.pendingIceCandidates[peerId].length} pending ICE candidates for ${peerId}`);
        
        // Add all pending candidates
        const candidates = this.pendingIceCandidates[peerId];
        this.pendingIceCandidates[peerId] = []; // Clear the queue

        for (const candidate of candidates) {
            await this.addIceCandidate(pc, candidate, peerId);
        }
    }

    handlePeerDisconnect(peerId) {
        if (this.peerConnections[peerId]) {
            this.peerConnections[peerId].close();
            delete this.peerConnections[peerId];
        }
        
        if (this.dataChannels[peerId]) {
            delete this.dataChannels[peerId];
        }
        
        this.removeParticipant(peerId);
        this.showNotification('Participant left the call');
    }

    addParticipant(peerId) {
        
        if (!this.participants[peerId]) {
            this.participants[peerId] = {
                id: peerId,
                video: document.createElement('video')
            };
            
            const videoElement = this.participants[peerId].video;
            videoElement.autoplay = true;
            videoElement.style.width = '80px';
            videoElement.style.height = '60px';
            videoElement.style.objectFit = 'cover';
            videoElement.style.borderRadius = '4px';
            
            const videoContainer = document.createElement('div');
            videoContainer.className = `participant-${peerId}`;
            videoContainer.style.position = 'relative';
            
            const nameLabel = document.createElement('div');
            nameLabel.textContent = `User ${peerId}`;
            nameLabel.style.position = 'absolute';
            nameLabel.style.bottom = '2px';
            nameLabel.style.left = '2px';
            nameLabel.style.backgroundColor = 'rgba(0,0,0,0.5)';
            nameLabel.style.color = 'white';
            nameLabel.style.fontSize = '10px';
            nameLabel.style.padding = '1px 4px';
            nameLabel.style.borderRadius = '2px';
            
            videoContainer.appendChild(videoElement);
            videoContainer.appendChild(nameLabel);
            this.remoteVideosContainer.appendChild(videoContainer);
            
            this.updateParticipantCount();
            if (this.isGalleryView) {
                this.updateGalleryLayout();
            }
        }
    }
    // Update layout for gallery view
updateGalleryLayout() {
    // Hide the standard remote videos container
    this.remoteVideosContainer.style.display = 'none';
    
    // Create or show gallery container if it doesn't exist
    if (!this.galleryContainer) {
        this.galleryContainer = document.createElement('div');
        this.galleryContainer.className = 'gallery-container';
        this.galleryContainer.style.display = 'grid';
        this.galleryContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        this.galleryContainer.style.gridAutoRows = 'minmax(150px, auto)';
        this.galleryContainer.style.gap = '10px';
        this.galleryContainer.style.padding = '10px';
        this.galleryContainer.style.height = this.isFullScreen ? 'calc(100% - 120px)' : '350px';
        this.galleryContainer.style.overflow = 'auto';
        this.bodyContainer.insertBefore(this.galleryContainer, this.controlsContainer);
    } else {
        this.galleryContainer.style.display = 'grid';
        this.galleryContainer.style.height = this.isFullScreen ? 'calc(100% - 120px)' : '350px';
    }
    
    // Clear the gallery
    this.galleryContainer.innerHTML = '';
    
    // Add self video to gallery
    const selfVideoContainer = this.createGalleryItem( this.userId, 'You', this.localVideo.srcObject);
    this.galleryContainer.appendChild(selfVideoContainer);
    
    // Add remote videos to gallery
    for (const peerId in this.participants) {
        const participant = this.participants[peerId];
        const name = `User ${peerId}`;
        const galleryItem = this.createGalleryItem(peerId, name, participant.video.srcObject);
        this.galleryContainer.appendChild(galleryItem);
    }
    
    // If in fullscreen, hide the standard video container
    if (this.isFullScreen) {
        this.videoContainer.style.display = 'none';
    } else {
        this.videoContainer.style.height = '100px';
    }
}
// Toggle between gallery view and standard view
toggleGalleryView() {
    this.isGalleryView = !this.isGalleryView;
    
    if (this.isGalleryView) {
        this.galleryViewButton.innerHTML = '◧';
        this.galleryViewButton.title = 'Switch to Standard View';
        this.showNotification('Gallery view enabled');
    } else {
        this.galleryViewButton.innerHTML = '◫';
        this.galleryViewButton.title = 'Switch to Gallery View';
        this.showNotification('Standard view enabled');
    }
    
    // Reset focused participant when toggling view
    this.focusedParticipant = null;
    
    // Update the layout
    this.updateLayout();
}

// Toggle fullscreen mode
toggleFullScreen() {
    this.isFullScreen = !this.isFullScreen;
    
    if (this.isFullScreen) {
        // Save original styles to restore later
        this.originalStyles = {
            position: this.mainContainer.style.position,
            bottom: this.mainContainer.style.bottom,
            right: this.mainContainer.style.right,
            width: this.mainContainer.style.width,
            height: this.mainContainer.style.height,
            maxWidth: this.mainContainer.style.maxWidth,
            zIndex: this.mainContainer.style.zIndex,
            borderRadius: this.mainContainer.style.borderRadius
        };
        
        // Apply fullscreen styles
        this.mainContainer.style.position = 'fixed';
        this.mainContainer.style.top = '0';
        this.mainContainer.style.left = '0';
        this.mainContainer.style.right = '0';
        this.mainContainer.style.bottom = '0';
        this.mainContainer.style.width = '100%';
        this.mainContainer.style.height = '100%';
        this.mainContainer.style.maxWidth = '100%';
        this.mainContainer.style.zIndex = '10000';
        this.mainContainer.style.borderRadius = '0';
        
        // Adjust video container for fullscreen
        this.videoContainer.style.height = this.isGalleryView ? '80%' : '85%';
        this.remoteVideosContainer.style.maxHeight = '20%';
        
        // Update button icon
        this.fullscreenButton.innerHTML = '⮌';
        this.showNotification('Fullscreen mode enabled');
    } else {
        // Restore original styles
        for (const [prop, value] of Object.entries(this.originalStyles)) {
            this.mainContainer.style[prop] = value;
        }
        
        // Reset video container size
        this.videoContainer.style.height = '196px';
        this.remoteVideosContainer.style.maxHeight = '150px';
        
        // Update button icon
        this.fullscreenButton.innerHTML = '⛶';
        this.showNotification('Fullscreen mode disabled');
    }
    
    // Update layout based on current view mode
    this.updateLayout();
}

// Update layout based on current view settings
updateLayout() {
    if (this.isGalleryView) {
        this.updateGalleryLayout();
    } else {
        this.updateStandardLayout();
    }
}
    removeParticipant(peerId) {
        if (this.participants[peerId]) {
            const participantEl = this.remoteVideosContainer.querySelector(`.participant-${peerId}`);
            if (participantEl) {
                this.remoteVideosContainer.removeChild(participantEl);
            }
            
            delete this.participants[peerId];
            this.updateParticipantCount();
        }
        if (this.focusedParticipant === peerId) {
            this.focusedParticipant = null;
        }
        
        // Update layout if in gallery view
        if (this.isGalleryView) {
            this.updateGalleryLayout();
        } else {
            this.updateStandardLayout();
        }
    }
    // Update layout for standard view
updateStandardLayout() {
    // Show the standard remote videos container
    this.remoteVideosContainer.style.display = 'flex';
    
    // Hide gallery container if exists
    if (this.galleryContainer) {
        this.galleryContainer.style.display = 'none';
    }
    
    // Show the main video container
    this.videoContainer.style.display = 'block';
    this.videoContainer.style.height = this.isFullScreen ? '85%' : '196px';
    
    // If we have a focused participant, show them in the main view
    if (this.focusedParticipant && this.focusedParticipant !==  this.userId) {
        if (this.participants[this.focusedParticipant]) {
            // Store original self video
            if (!this.originalSelfVideo) {
                this.originalSelfVideo = this.localVideo.srcObject;
            }
            
            // Swap the videos
            this.localVideo.srcObject = this.participants[this.focusedParticipant].video.srcObject;
            this.videoOverlay.textContent = `User ${this.focusedParticipant} (focused)`;
        }
    } else {
        // Restore original self video if needed
        if (this.originalSelfVideo) {
            this.localVideo.srcObject = this.originalSelfVideo;
            this.videoOverlay.textContent = 'You';
            this.originalSelfVideo = null;
        }
    }
}

    updateParticipantCount() {
        const count = Object.keys(this.participants).length + 1; // +1 for local user
        this.participantCounter.textContent = count;
    }

    async createOffer(peerId) {
        console.log(`Creating offer for ${peerId}`);
        
        // Reuse existing connection if available
        let peerConnection = this.peerConnections[peerId];
        if (peerConnection) {
            console.log(`Existing connection found. Current state: ${peerConnection.signalingState}`);
            if (peerConnection.signalingState !== "stable") {
                console.warn(`Cannot create offer in state: ${peerConnection.signalingState}`);
                return;
            }
        } else {
            console.log(`Creating new peer connection for ${peerId}`);
            peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            this.peerConnections[peerId] = peerConnection;
    
            // Add local tracks
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, this.localStream);
                });
            }
    
            // ICE Candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log("Sending ICE candidate to peer:", peerId);
                    this.socket.send(JSON.stringify({
                        type: 'candidate',
                        target: peerId,
                        senderId: this.userId,
                        candidate: event.candidate
                    }));
                }
            };
    
            peerConnection.onconnectionstatechange = () => {
                console.log(`Connection state changed to: ${peerConnection.connectionState}`);
                if (peerConnection.connectionState === 'connected') {
                    this.showNotification('Connected to peer', 'success');
                } else if (['disconnected', 'failed'].includes(peerConnection.connectionState)) {
                    this.showNotification('Peer connection lost', 'error');
                }
            };
    
            peerConnection.ontrack = (event) => {
                console.log("Remote track received:", event.streams[0]);
                this.addParticipant(peerId);
                if (this.participants[peerId]) {
                    console.log("Setting remote stream for participant:", peerId);
                    this.participants[peerId].video.srcObject = event.streams[0];
                }
            };
    
            // Create data channels
            this.createDataChannel(peerId, "chat");
            this.createDataChannel(peerId, "fileTransfer");
        }

        try {
            // Ensure we're in a valid state
            if (peerConnection.signalingState !== "stable") {
                console.log("Rolling back any existing descriptions");
                await peerConnection.setLocalDescription({type: "rollback"});
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log("Creating offer");
            const offer = await peerConnection.createOffer();
            
            console.log("Setting local description");
            await peerConnection.setLocalDescription(offer);

            // Wait for ICE gathering to complete
            await new Promise(resolve => {
                if (peerConnection.iceGatheringState === "complete") {
                    resolve();
                } else {
                    peerConnection.addEventListener("icegatheringstatechange", () => {
                        if (peerConnection.iceGatheringState === "complete") {
                            resolve();
                        }
                    });
                }
            });

            console.log("Sending offer");
            this.socket.send(JSON.stringify({
                type: 'offer',
                target: peerId,
                senderId: this.userId,
                offer: peerConnection.localDescription
            }));

            console.log(`Offer creation completed. Final state: ${peerConnection.signalingState}`);
        } catch (error) {
            console.error('Error creating offer:', error);
            this.showNotification('Failed to create connection offer', 'error');

            if (error.name === 'InvalidStateError') {
                console.log("Attempting state recovery for offer creation...");
                try {
                    // Reset to stable state
                    if (peerConnection.signalingState !== "stable") {
                        await peerConnection.setLocalDescription({type: "rollback"});
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    // Try the offer creation again
                    const newOffer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(newOffer);

                    // Wait for ICE gathering
                    await new Promise(resolve => {
                        if (peerConnection.iceGatheringState === "complete") {
                            resolve();
                        } else {
                            peerConnection.addEventListener("icegatheringstatechange", () => {
                                if (peerConnection.iceGatheringState === "complete") {
                                    resolve();
                                }
                            });
                        }
                    });

                    this.socket.send(JSON.stringify({
                        type: 'offer',
                        target: peerId,
                        senderId: this.userId,
                        offer: peerConnection.localDescription
                    }));

                    console.log("Successfully recovered and created offer");
                } catch (recoveryError) {
                    console.error('Failed to recover:', recoveryError);
                    // If recovery fails, recreate the connection
                    this.handlePeerDisconnect(peerId);
                    this.createPeerConnection(peerId);
                }
            }
        }
    }
    
    async createAnswer(data) {
        const peerId = data.senderId;
        
        console.log(`Creating answer for ${peerId}. Processing offer...`);
        
        let peerConnection = this.peerConnections[peerId];
        if (!peerConnection) {
            console.log(`Creating new peer connection for ${peerId}`);
            peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            
            this.peerConnections[peerId] = peerConnection;
            
            // Add local tracks
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, this.localStream);
                });
            }
            
            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.socket.send(JSON.stringify({
                        type: 'candidate',
                        target: peerId,
                        senderId: this.userId,
                        candidate: event.candidate
                    }));
                }
            };
            
            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                console.log(`Connection state changed to: ${peerConnection.connectionState}`);
                if (peerConnection.connectionState === 'connected') {
                    this.showNotification('Connected to peer', 'success');
                }
            };
            
            // Handle receiving tracks
            peerConnection.ontrack = (event) => {
                console.log(`Received track from ${peerId}`);
                this.addParticipant(peerId);
                if (this.participants[peerId]) {
                    this.participants[peerId].video.srcObject = event.streams[0];
                }
            };
            
            // Handle data channels
            peerConnection.ondatachannel = (event) => {
                this.setupDataChannel(peerId, event.channel, event.channel.label);
            };
        }
        
        try {
            console.log(`Current signaling state: ${peerConnection.signalingState}`);
            
            // Ensure we're in a valid state to process the offer
            if (peerConnection.signalingState !== "stable") {
                console.log("Rolling back any existing descriptions");
                await peerConnection.setLocalDescription({type: "rollback"});
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log("Setting remote description from offer");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            // Process any pending ICE candidates
            await this.addPendingIceCandidates(peerId);
            
            // Small delay to ensure remote description and ICE candidates are fully applied
            await new Promise(resolve => setTimeout(resolve, 100));
            
            console.log("Creating answer");
            const answer = await peerConnection.createAnswer();
            
            console.log("Setting local description");
            await peerConnection.setLocalDescription(answer);
            
            // Wait for ICE gathering to complete
            await new Promise(resolve => {
                if (peerConnection.iceGatheringState === "complete") {
                    resolve();
                } else {
                    peerConnection.addEventListener("icegatheringstatechange", () => {
                        if (peerConnection.iceGatheringState === "complete") {
                            resolve();
                        }
                    });
                }
            });
            
            console.log("Sending answer");
            this.socket.send(JSON.stringify({
                type: 'answer',
                target: peerId,
                senderId: this.userId,
                answer: peerConnection.localDescription
            }));
            
            console.log(`Answer creation completed. Final state: ${peerConnection.signalingState}`);
        } catch (error) {
            console.error('Error creating answer:', error);
            this.showNotification('Failed to create connection answer', 'error');
            
            if (error.name === 'InvalidStateError') {
                console.log("Attempting state recovery for answer creation...");
                try {
                    // Reset to stable state
                    if (peerConnection.signalingState !== "stable") {
                        await peerConnection.setLocalDescription({type: "rollback"});
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                    // Try the offer/answer exchange again
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Process any pending ICE candidates
                    await this.addPendingIceCandidates(peerId);
                    
                    const newAnswer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(newAnswer);
                    
                    // Wait for ICE gathering
                    await new Promise(resolve => {
                        if (peerConnection.iceGatheringState === "complete") {
                            resolve();
                        } else {
                            peerConnection.addEventListener("icegatheringstatechange", () => {
                                if (peerConnection.iceGatheringState === "complete") {
                                    resolve();
                                }
                            });
                        }
                    });
                    
                    this.socket.send(JSON.stringify({
                        type: 'answer',
                        target: peerId,
                        senderId: this.userId,
                        answer: peerConnection.localDescription
                    }));
                    
                    console.log("Successfully recovered and created answer");
                } catch (recoveryError) {
                    console.error('Failed to recover:', recoveryError);
                    // If recovery fails, recreate the connection
                    this.handlePeerDisconnect(peerId);
                    this.createPeerConnection(peerId);
                }
            }
        }
    }

    createDataChannel(peerId, label) {
        if (this.peerConnections[peerId]) {
            try {
                const dataChannel = this.peerConnections[peerId].createDataChannel(label);
                this.setupDataChannel(peerId, dataChannel, label);
            } catch (error) {
                console.error(`Error creating ${label} data channel:`, error);
            }
        }
    }

    setupDataChannel(peerId, dataChannel, label) {
        // Initialize dataChannels object structure
        this.dataChannels[peerId] = this.dataChannels[peerId] || {};
        
        dataChannel.binaryType = "arraybuffer";
        
        dataChannel.onopen = () => {
            console.log(`${label} DataChannel opened with ${peerId}`);
            if (label === "chat") {
                setTimeout(() => {
                    console.log("Testing data channel...");
                    dataChannel.send("Test message from channel setup");
                }, 1000);
            }
        };
        
        dataChannel.onclose = () => {
            console.log(`${label} DataChannel closed with ${peerId}`);
        };
        
        dataChannel.onerror = (error) => {
            console.error(`${label} DataChannel error with ${peerId}:`, error);
        };
        
        if (label === "chat") {
            dataChannel.onmessage = (event) => {
                console.log("Received message via data channel:", event.data);
                this.receiveMessage({
                    senderId: peerId,
                    message: event.data
                });
            };
        } else if (label === "fileTransfer") {
            dataChannel.onmessage = (event) => {
                // Check if it's file metadata or actual chunk
                if (typeof event.data === 'string') {
                    try {
                        const metadata = JSON.parse(event.data);
                        if (metadata.type === "file_meta") {
                            this.prepareForFileReception(metadata);
                        }
                    } catch (e) {
                        console.error("Error parsing file metadata:", e);
                    }
                } else {
                    // It's a file chunk
                    this.receiveFileChunk({
                        senderId: peerId,
                        chunk: event.data
                    });
                }
            };
        }
        
        this.dataChannels[peerId][label] = dataChannel;
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isLocalAudioMuted = !audioTrack.enabled;
                
                if (this.isLocalAudioMuted) {
                    this.controlsContainer.audioBtn.innerHTML = '🔇';
                    this.controlsContainer.audioBtn.style.backgroundColor = '#e74c3c';
                    this.controlsContainer.audioBtn.style.color = 'white';
                    this.showNotification('Microphone muted');
                } else {
                    this.controlsContainer.audioBtn.innerHTML = '🎤';
                    this.controlsContainer.audioBtn.style.backgroundColor = '#e0e0e0';
                    this.controlsContainer.audioBtn.style.color = 'black';
                    this.showNotification('Microphone unmuted');
                }
            }
        }
    }
    
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isLocalVideoMuted = !videoTrack.enabled;
                
                if (this.isLocalVideoMuted) {
                    this.controlsContainer.videoBtn.innerHTML = '🚫';
                    this.controlsContainer.videoBtn.style.backgroundColor = '#e74c3c';
                    this.controlsContainer.videoBtn.style.color = 'white';
                    this.showNotification('Camera turned off');
                    
                    // Add a placeholder for the video
                    this.localVideo.style.backgroundColor = '#2c3e50';
                    const placeholderText = document.createElement('div');
                    placeholderText.className = 'video-placeholder';
                    placeholderText.textContent = 'Camera Off';
                    placeholderText.style.position = 'absolute';
                    placeholderText.style.top = '50%';
                    placeholderText.style.left = '50%';
                    placeholderText.style.transform = 'translate(-50%, -50%)';
                    placeholderText.style.color = 'white';
                    placeholderText.style.fontSize = '18px';
                    this.videoContainer.appendChild(placeholderText);
                } else {
                    this.controlsContainer.videoBtn.innerHTML = '📹';
                    this.controlsContainer.videoBtn.style.backgroundColor = '#e0e0e0';
                    this.controlsContainer.videoBtn.style.color = 'black';
                    this.showNotification('Camera turned on');
                    
                    // Remove placeholder if exists
                    const placeholder = this.videoContainer.querySelector('.video-placeholder');
                    if (placeholder) {
                        this.videoContainer.removeChild(placeholder);
                    }
                    this.localVideo.style.backgroundColor = 'transparent';
                }
            }
        }
    }
    
    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { cursor: "always" },
                    audio: false 
                });
                
                // Store original video track to restore later
                this.originalVideoTrack = this.localStream.getVideoTracks()[0];
                
                // Replace video track with screen track in all peer connections
                const screenTrack = this.screenStream.getVideoTracks()[0];
                
                if (screenTrack) {
                    // Replace the track in all peer connections
                    for (let peerId in this.peerConnections) {
                        const sender = this.peerConnections[peerId]
                            .getSenders()
                            .find(s => s.track && s.track.kind === 'video');
                            
                        if (sender) {
                            sender.replaceTrack(screenTrack);
                        }
                    }
                    
                    // Update local video display
                    this.localVideo.srcObject = this.screenStream;
                    this.isScreenSharing = true;
                    this.controlsContainer.screenBtn.innerHTML = '🛑';
                    this.controlsContainer.screenBtn.style.backgroundColor = '#e74c3c';
                    this.controlsContainer.screenBtn.style.color = 'white';
                    this.showNotification('Screen sharing started', 'success');
                    
                    // Listen for screen share stop
                    screenTrack.onended = () => {
                        this.stopScreenShare();
                    };
                }
            } catch (error) {
                console.error('Error starting screen share:', error);
                this.showNotification('Failed to start screen sharing', 'error');
            }
        } else {
            this.stopScreenShare();
        }
    }
    
    stopScreenShare() {
        if (this.isScreenSharing && this.screenStream) {
            // Stop all tracks in the screen stream
            this.screenStream.getTracks().forEach(track => track.stop());
            
            // Restore original video track in all peer connections
            if (this.originalVideoTrack) {
                for (let peerId in this.peerConnections) {
                    const sender = this.peerConnections[peerId]
                        .getSenders()
                        .find(s => s.track && s.track.kind === 'video');
                        
                    if (sender) {
                        sender.replaceTrack(this.originalVideoTrack);
                    }
                }
                
                // Restore local video display
                this.localVideo.srcObject = this.localStream;
            }
            
            this.isScreenSharing = false;
            this.controlsContainer.screenBtn.innerHTML = '🖥️';
            this.controlsContainer.screenBtn.style.backgroundColor = '#e0e0e0';
            this.controlsContainer.screenBtn.style.color = 'black';
            this.showNotification('Screen sharing stopped');
        }
    }
    
    sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message) return;
        
        // Display locally
        this.displayMessage("Me", message);
        
        // Send to all peers
        for (let peerId in this.dataChannels) {
            if (this.dataChannels[peerId].chat && 
                this.dataChannels[peerId].chat.readyState === 'open') {
                this.dataChannels[peerId].chat.send(message);
            }
        }
        
        // Clear input
        this.chatInput.value = '';
    }
    
    receiveMessage(data) {
        this.displayMessage(`User ${data.senderId}`, data.message);
        
        // Highlight chat button if chat is not open
        if (this.chatContainer.style.display === 'none') {
            this.controlsContainer.chatBtn.style.backgroundColor = '#e74c3c';
            this.controlsContainer.chatBtn.style.color = 'white';
            this.showNotification('New message received');
        }
    }
    
    displayMessage(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.style.marginBottom = '8px';
        
        const senderElement = document.createElement('strong');
        senderElement.textContent = sender;
        senderElement.style.marginRight = '5px';
        
        if (sender === 'Me') {
            messageElement.style.textAlign = 'right';
            messageElement.style.color = '#4a69bd';
        }
        
        const contentElement = document.createElement('span');
        contentElement.textContent = message;
        contentElement.style.wordBreak = 'break-word';
        
        messageElement.appendChild(senderElement);
        messageElement.appendChild(document.createElement('br'));
        messageElement.appendChild(contentElement);
        
        this.chatMessages.appendChild(messageElement);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    sendFile() {
        const file = this.fileInput.files[0];
        if (!file) return;
        
        // Show notification
        this.showNotification(`Sending file: ${file.name}`, 'info');
        
        // Send file metadata to all peers
        for (let peerId in this.dataChannels) {
            if (this.dataChannels[peerId].fileTransfer && 
                this.dataChannels[peerId].fileTransfer.readyState === 'open') {
                
                const metadata = JSON.stringify({
                    type: "file_meta",
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type
                });
                
                this.dataChannels[peerId].fileTransfer.send(metadata);
            }
        }
        
        // Read and send the file
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = () => {
            const buffer = reader.result;
            const chunkSize = 16384; // 16 KB chunks to avoid buffer limitations
            
            // Update chat with file info
            this.displayMessage('Me', `📎 Sent file: ${file.name} (${this.formatFileSize(file.size)})`);
            
            // Send file in chunks
            for (let peerId in this.dataChannels) {
                if (this.dataChannels[peerId].fileTransfer && 
                    this.dataChannels[peerId].fileTransfer.readyState === 'open') {
                    
                    // Send in chunks to avoid data channel buffer limitations
                    for (let i = 0; i < buffer.byteLength; i += chunkSize) {
                        const chunk = buffer.slice(i, i + chunkSize);
                        this.dataChannels[peerId].fileTransfer.send(chunk);
                    }
                    
                    // Send end marker
                    setTimeout(() => {
                        this.dataChannels[peerId].fileTransfer.send(JSON.stringify({ type: "file_end" }));
                    }, 100);
                }
            }
            
            // Reset file input
            this.fileInput.value = '';
        };
    }
    
    prepareForFileReception(metadata) {
        // Reset file chunks array
        this.fileChunks = [];
        this.fileMetadata = metadata;
        
        // Notify user about incoming file
        this.showNotification(`Receiving file: ${metadata.fileName}`, 'info');
    }
    
    receiveFileChunk(data) {
        // Check if it's the end marker
        if (typeof data.chunk === 'string') {
            try {
                const marker = JSON.parse(data.chunk);
                if (marker.type === 'file_end') {
                    this.finalizeFileReception();
                    return;
                }
            } catch (e) {
                // Not JSON, treat as normal chunk
            }
        }
        
        // Add chunk to array
        this.fileChunks.push(data.chunk);
    }
    
    finalizeFileReception() {
        if (!this.fileChunks.length || !this.fileMetadata) return;
        
        // Combine all chunks
        const blob = new Blob(this.fileChunks, { type: this.fileMetadata.fileType || 'application/octet-stream' });
        
        // Create download link
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = this.fileMetadata.fileName || 'received_file';
        link.style.display = 'none';
        
        // Add to document and click
        document.body.appendChild(link);
        link.click();
        
        // Clean up
        setTimeout(() => {
            URL.revokeObjectURL(link.href);
            document.body.removeChild(link);
        }, 100);
        
        // Show notification and update chat
        this.showNotification(`File received: ${this.fileMetadata.fileName}`, 'success');
        this.displayMessage(`User ${data.senderId}`, `📎 Sent file: ${this.fileMetadata.fileName} (${this.formatFileSize(this.fileMetadata.fileSize)})`);
        
        // Reset file data
        this.fileChunks = [];
        this.fileMetadata = null;
    }
    
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' bytes';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    }
    
    // Method to end the call and clean up resources
    endCall() {
        // Close all peer connections
        for (let peerId in this.peerConnections) {
            this.peerConnections[peerId].close();
        }
        
        // Close WebSocket connection
        if (this.socket) {
            this.socket.close();
        }
        
        // Stop all media streams
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Remove UI elements
        if (this.mainContainer && this.mainContainer.parentNode) {
            this.mainContainer.parentNode.removeChild(this.mainContainer);
        }
        
        if (this.fileInput && this.fileInput.parentNode) {
            this.fileInput.parentNode.removeChild(this.fileInput);
        }
        
        this.showNotification('Call ended', 'info');
        this.isCallActive = false;
    }

    
}
