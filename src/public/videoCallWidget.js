class VideoCallWidget {
    constructor(config = {}) {
        this.websocketUrl = config.websocketUrl || 'wss://yourserver.com';
        this.roomId = config.roomId || 'default-room';
        this.authToken = config.authToken;
        this.socket = null;
        this.peerConnections = {};
        this.dataChannels = {};
        this.isScreenSharing = false;
        this.receivedFile = null;

        this.initialize();
    }

    initialize() {
        this.createUI();
        this.connectWebSocket();
    }

    createUI() {
        this.videoContainer = document.createElement('div');
        this.videoContainer.style.position = 'fixed';
        this.videoContainer.style.bottom = '20px';
        this.videoContainer.style.right = '20px';

        this.localVideo = document.createElement('video');
        this.localVideo.autoplay = true;
        this.localVideo.muted = true;

        this.screenShareButton = document.createElement('button');
        this.screenShareButton.innerText = "Share Screen";
        this.screenShareButton.onclick = () => this.toggleScreenShare();

        this.fileInput = document.createElement('input');
        this.fileInput.type = "file";
        this.fileInput.style.display = "none";
        this.fileInput.addEventListener('change', () => this.sendFile());

        this.fileButton = document.createElement('button');
        this.fileButton.innerText = "Send File";
        this.fileButton.onclick = () => this.fileInput.click();

        this.chatContainer = document.createElement('div');
        this.chatContainer.style.position = 'absolute';
        this.chatContainer.style.bottom = '0';
        this.chatContainer.style.width = '250px';
        this.chatContainer.style.height = '150px';
        this.chatContainer.style.overflowY = 'auto';
        this.chatContainer.style.background = 'white';
        this.chatContainer.style.border = '1px solid #ddd';
        this.chatContainer.style.padding = '5px';

        this.chatMessages = document.createElement('div');
        this.chatContainer.appendChild(this.chatMessages);

        this.chatInput = document.createElement('input');
        this.chatInput.type = 'text';
        this.chatInput.placeholder = 'Type a message...';
        this.chatInput.style.width = '80%';
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        this.chatSendButton = document.createElement('button');
        this.chatSendButton.innerText = 'Send';
        this.chatSendButton.onclick = () => this.sendMessage();

        this.videoContainer.appendChild(this.localVideo);
        this.videoContainer.appendChild(this.screenShareButton);
        this.videoContainer.appendChild(this.fileButton);
        this.videoContainer.appendChild(this.chatContainer);
        this.videoContainer.appendChild(this.chatInput);
        this.videoContainer.appendChild(this.chatSendButton);

        document.body.appendChild(this.videoContainer);
    }

    connectWebSocket() {
        this.socket = new WebSocket(`${this.websocketUrl}?token=${this.authToken}`);

        this.socket.onopen = () => {
            this.socket.send(JSON.stringify({ type: 'join', roomId: this.roomId }));
        };

        this.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'new_peer':
                    this.createOffer(data.userId);
                    break;
                case 'offer':
                    this.createAnswer(data);
                    break;
                case 'answer':
                    this.peerConnections[data.senderId].setRemoteDescription(new RTCSessionDescription(data.answer));
                    break;
                case 'candidate':
                    this.peerConnections[data.senderId].addIceCandidate(new RTCIceCandidate(data.candidate));
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
            }
        };
    }

    async createOffer(peerId) {
        const peerConnection = new RTCPeerConnection();
        this.peerConnections[peerId] = peerConnection;

        this.localStream.getTracks().forEach(track => peerConnection.addTrack(track, this.localStream));

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.send(JSON.stringify({ type: 'candidate', target: peerId, candidate: event.candidate }));
            }
        };

        // Create DataChannels for Chat & File Sharing
        this.createDataChannel(peerId, "chat");
        this.createDataChannel(peerId, "fileTransfer");

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        this.socket.send(JSON.stringify({ type: 'offer', target: peerId, offer }));
    }

    createDataChannel(peerId, label) {
        const dataChannel = this.peerConnections[peerId].createDataChannel(label);
        this.setupDataChannel(peerId, dataChannel, label);
    }

    setupDataChannel(peerId, dataChannel, label) {
        this.dataChannels[peerId] = this.dataChannels[peerId] || {};
        this.dataChannels[peerId][label] = dataChannel;

        dataChannel.binaryType = "arraybuffer";

        dataChannel.onopen = () => console.log(`${label} DataChannel opened with ${peerId}`);

        if (label === "chat") {
            dataChannel.onmessage = (event) => this.receiveMessage({ senderId: peerId, message: event.data });
        } else if (label === "fileTransfer") {
            dataChannel.onmessage = (event) => this.receiveFileChunk({ senderId: peerId, chunk: event.data });
        }
    }

    sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message) return;

        this.displayMessage("Me", message);

        for (let peerId in this.dataChannels) {
            this.dataChannels[peerId].chat.send(message);
        }

        this.chatInput.value = '';
    }

    receiveMessage(data) {
        this.displayMessage(`User ${data.senderId}`, data.message);
    }

    displayMessage(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        this.chatMessages.appendChild(messageElement);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    async toggleScreenShare() {
        if (!this.isScreenSharing) {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

            for (let peerId in this.peerConnections) {
                let sender = this.peerConnections[peerId].getSenders().find(s => s.track.kind === "video");
                sender.replaceTrack(this.screenStream.getVideoTracks()[0]);
            }

            this.localVideo.srcObject = this.screenStream;
            this.isScreenSharing = true;
            this.screenShareButton.innerText = "Stop Sharing";
        } else {
            this.stopScreenShare();
        }
    }

    stopScreenShare() {
        if (this.isScreenSharing) {
            this.screenStream.getTracks().forEach(track => track.stop());

            for (let peerId in this.peerConnections) {
                let sender = this.peerConnections[peerId].getSenders().find(s => s.track.kind === "video");
                sender.replaceTrack(this.localStream.getVideoTracks()[0]);
            }

            this.localVideo.srcObject = this.localStream;
            this.isScreenSharing = false;
            this.screenShareButton.innerText = "Share Screen";
        }
    }

    sendFile() {
        const file = this.fileInput.files[0];
        if (!file) return;

        for (let peerId in this.dataChannels) {
            this.dataChannels[peerId].fileTransfer.send(JSON.stringify({
                type: "file_meta",
                fileName: file.name,
                fileSize: file.size,
            }));
        }

        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = () => {
            for (let peerId in this.dataChannels) {
                this.dataChannels[peerId].fileTransfer.send(reader.result);
            }
        };
    }

    receiveFileChunk(data) {
        const receivedBlob = new Blob([data.chunk]);
        this.downloadReceivedFile(receivedBlob, "received_file");
    }

    downloadReceivedFile(blob, fileName) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
