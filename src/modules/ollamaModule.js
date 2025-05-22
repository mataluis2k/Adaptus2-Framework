const { spawn, execSync } = require('child_process');

const { authenticateMiddleware } = require("../middleware/authenticationMiddleware");
const { Ollama }= require('ollama');
const eventLogger  = require('./EventLogger');
// Configure Ollama client with base URL
const OLLAMA_HOST = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const ollamaClient = new Ollama({ host: OLLAMA_HOST });
const ollama_inference = process.env.OLLAMA_INFERENCE || 'llama3';
class OllamaModule {
    constructor() {
        this.model = ollama_inference;
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
            console.log('Ollama module initialized successfully',models);
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

    async generateResponse(prompt, messages = [], format = 'text', opts = {}) {
        await this.ensureInitialized();
        try {
            // For Ollama, we'll concatenate previous messages into the prompt
            const contextPrompt = messages.map(msg => 
                `${msg.role}: ${msg.content}`
            ).join('\n');
            
            const fullPrompt = contextPrompt ? 
                `${contextPrompt}\nuser: ${prompt}` : 
                prompt;
    
            const requestOptions = {
                model: opts.model || this.model,
                prompt: fullPrompt,
                stream: false,
            };
            if (format === 'json') {
                requestOptions.format = 'json';
            }
            if (opts && Object.keys(opts).length > 0) {
                requestOptions.options = opts.options || opts;
            }
            console.log('Using Ollama model:', requestOptions.model);
            
            try {
                const response = await this.ollama.generate(requestOptions);
                return response.response;
            } catch (fetchError) {
                console.error('Fetch error in Ollama generate:', fetchError);
                return `Error: Unable to reach Ollama service. Please ensure Ollama is running and accessible at ${OLLAMA_HOST}.`;
            }
        } catch (error) {
            console.error('Failed to generate response:', error.message);
            return `Error: ${error.message}`;
        }
    }
    // Method to handle chat messages
    async processMessage(messageData, history = [], opts = {}) {
        const { senderId, recipientId, groupName, message, format } = messageData;
        
        try {
            // Pass history directly to generateResponse
            const aiResponse = await this.generateResponse(message, history, format, opts);
            
            // Check if response is an error message
            const isError = typeof aiResponse === 'string' && aiResponse.startsWith('Error:');
            
            // Prepare response data
            const responseData = {
                senderId: 'AI_Assistant',
                recipientId: senderId,
                groupName: groupName,
                message: aiResponse,
                status: isError ? 'error' : 'delivered'
            };

            // Save AI response to database only if not an error
            if (!isError) {
                try {
                    await this.saveResponse(responseData);
                } catch (dbError) {
                    console.error('Error saving response to database:', dbError);
                    // Continue despite database error
                }
            }

            return responseData;
        } catch (error) {
            console.error('Error processing message:', error);
            // Return error response instead of throwing
            return {
                senderId: 'AI_Assistant',
                recipientId: senderId,
                groupName: groupName,
                message: `Error processing your request: ${error.message}`,
                status: 'error'
            };
        }
    }

    async saveResponse(responseData) {
  
      
        // Shape a payload matching your messages table columns
        const payload = {
          sender_id:    responseData.senderId   || null,
          recipient_id: responseData.recipientId|| null,
          group_name:   responseData.groupName  || null,
          message:      responseData.message    || null,
          status:       responseData.status     || null,
          created_at:   new Date()               // was NOW() in SQL
        };
       let config = {
            dbType: process.env.DEFAULT_DBTYPE || 'mysql',
            dbConnection: process.env.DEFAULT_DB_CONNECTION || 'default'
            };

        // Enqueue for non-blocking insert
        await eventLogger.log(
          config,      // { dbType, dbConnection }
          'messages',  // table/entity name
          payload
        );
      }

    // Setup REST endpoints with token authentication
    setupRoutes(app) {
        app.post('/api/ollama/generate',
            authenticateMiddleware(true),
            async (req, res) => {
                try {
                    const { prompt, messages, options } = req.body;
                    if (!prompt) {
                        return res.status(400).json({ error: 'Prompt is required' });
                    }

                    const response = await this.generateResponse(prompt, messages || [], 'text', options || {});
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
