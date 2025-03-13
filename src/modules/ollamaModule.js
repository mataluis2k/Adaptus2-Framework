const { spawn, execSync } = require('child_process');
const { getDbConnection } = require("./db");
const { authenticateMiddleware } = require("../middleware/authenticationMiddleware");
const { Ollama }= require('ollama');

// Configure Ollama client with base URL
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const ollamaClient = new Ollama({ host: OLLAMA_HOST });

class OllamaModule {
    constructor(model = 'deepseek-r1:7b') {
        this.model = model;
        this.initialized = true;
        this.ollamaProcess = null;
        this.ollama = ollamaClient;
        this.initPromise = null;
    }

    async ensureInitialized() {
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        return this.initPromise;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            await this.ensureOllamaInstalled();
            await this.ensureOllamaRunning();
          

            try {
                await fetch(`${OLLAMA_HOST}/api/version`);
                const modelsResponse = await this.ollama.list();
                const models = modelsResponse.models || [];
                
                if (!models.find(m => m.name === this.model)) {
                    console.log(`Model ${this.model} not found. Pulling from Ollama...`);
                    await this.pullModel();
                }
            } catch (error) {
                throw new Error(`Failed to connect to Ollama server: ${error.message}. Ensure the Ollama server is running with 'ollama serve'.`);
            }

            this.initialized = true;
            console.log('Ollama module initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Ollama module:', error.message);
            throw error;
        }
    }

    async ensureOllamaInstalled() {
        try {
            // Check if Ollama is installed
            execSync('ollama --version');
            console.log('Ollama is already installed');
        } catch (error) {
            const message = `
Ollama is required but not installed. Please install it manually:

For Linux:
    curl -fsSL https://ollama.ai/install.sh | sh

For macOS:
    curl -fsSL https://ollama.ai/install.sh | sh
    
For Windows:
    Download from: https://ollama.ai/download

After installing, start the Ollama server with:
    ollama serve

For more information, visit: https://ollama.ai/download
`;
            throw new Error(message);
        }
    }

    async ensureOllamaRunning() {
        if (await this.isOllamaRunning()) {
            console.log('Ollama server is already running');
            return;
        }

        console.log('Starting Ollama server...');
        try {
            execSync('pkill ollama');
        } catch (error) {}

        this.ollamaProcess = spawn('ollama', ['serve'], { stdio: 'ignore', detached: true });
        this.ollamaProcess.unref();

        await new Promise((resolve, reject) => {
            const checkServer = async () => {
                if (await this.isOllamaRunning()) resolve();
                else setTimeout(checkServer, 1000);
            };
            checkServer();
            setTimeout(() => reject(new Error('Timeout waiting for Ollama server')), 30000);
        });

        console.log('Ollama server started successfully');
        process.on('exit', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
    }

    async pullModel() {
        try {
            await this.ollama.pull(this.model);
            console.log(`Successfully pulled ${this.model} model`);
        } catch (error) {
            console.error('Failed to pull model:', error.message);
            throw error;
        }
    }
    
    async isOllamaRunning() {
        try {
            const response = await fetch(`${OLLAMA_HOST}/api/version`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async generateResponse(prompt, messages = []) {
        await this.ensureInitialized();
        try {
            // For Ollama, we'll concatenate previous messages into the prompt
            const contextPrompt = messages.map(msg => 
                `${msg.role}: ${msg.content}`
            ).join('\n');
            
            const fullPrompt = contextPrompt ? 
                `${contextPrompt}\nuser: ${prompt}` : 
                prompt;
    
            const response = await this.ollama.generate({ 
                model: this.model, 
                prompt: fullPrompt,
                stream: false 
            });
    
            return response.response;
        } catch (error) {
            console.error('Failed to generate response:', error.message);
            throw error;
        }
    }
    // Method to handle chat messages
    async processMessage(messageData, history = []) {
        const { senderId, recipientId, groupName, message } = messageData;
        
        try {
            // Pass history directly to generateResponse
            const aiResponse = await this.generateResponse(message, history);
            
            // Prepare response data
            const responseData = {
                senderId: 'AI_Assistant',
                recipientId: senderId,
                groupName: groupName,
                message: aiResponse,
                status: 'delivered'
            };

            // Save AI response to database
            await this.saveResponse(responseData);

            return responseData;
        } catch (error) {
            console.error('Error processing message:', error);
            throw error;
        }
    }

    async saveResponse(responseData) {
        const dbType = process.env.STREAMING_DBTYPE || "mysql";
        const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";
        const config = { dbType, dbConnection };

        const sql = `
            INSERT INTO messages (sender_id, recipient_id, group_name, message, status, timestamp)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;

        const values = [
            responseData.senderId,
            responseData.recipientId,
            responseData.groupName,
            responseData.message,
            responseData.status
        ];

        try {
            const connection = await getDbConnection(config);
            const [result] = await connection.execute(sql, values);
            console.log("AI response saved successfully:", result);
        } catch (error) {
            console.error("Error saving AI response:", error);
            throw error;
        }
    }

    // Setup REST endpoints with token authentication
    setupRoutes(app) {
        app.post('/api/ollama/generate',
            authenticateMiddleware(true),
            async (req, res) => {
                try {
                    const { prompt, messages } = req.body;
                    if (!prompt) {
                        return res.status(400).json({ error: 'Prompt is required' });
                    }

                    const response = await this.generateResponse(prompt, messages || []);
                    res.json({ response });
                } catch (error) {
                    console.error('Error in generate endpoint:', error);
                    res.status(500).json({ error: 'Internal server error' });
                }
            }
        );

        app.get('/api/ollama/status',
            authenticateMiddleware(true),
            async (req, res) => {
                try {
                    const modelsResponse = await this.ollama.list();
                    const models = modelsResponse.models || [];
                    const modelStatus = models.find(m => m.name === this.model);
                    
                    res.json({
                        initialized: this.initialized,
                        model: this.model,
                        modelPresent: !!modelStatus,
                        serverRunning: !!this.ollamaProcess
                    });
                } catch (error) {
                    console.error('Error in status endpoint:', error);
                    res.status(500).json({ error: 'Internal server error' });
                }
            }
        );
    }

    // Cleanup method
    cleanup() {
        if (this.ollamaProcess) {
            this.ollamaProcess.kill();
            this.ollamaProcess = null;
        }
    }
}

module.exports = new OllamaModule();
