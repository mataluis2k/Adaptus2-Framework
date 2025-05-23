const axios = require('axios');
const logger = require('./logger');
const ollamaModule = require('./ollamaModule');
const path = require('path');
const fs = require('fs');
const buildPersonaPrompt = require('./buildPersonaPrompt');
const { redisClient } = require('./redisClient');
const crypto = require('crypto');
global.llmModule = null; // Initialize global reference to prevent circular dependency issues

/**
 * Extracts relevant keywords from a persona configuration
 * Uses both rule-based approach and LLM assistance for comprehensive coverage
 * @param {string} personaName - The name of the persona
 * @param {Object} personaConfig - The configuration for this persona
 * @returns {Promise<string[]>} - Array of extracted keywords
 */
async function extractKeywordsFromPersona(personaName, personaConfig) {
    // Rule-based keyword extraction first
    const keywordSet = new Set();
    
    // Helper function to add keywords from text
    const addKeywordsFromText = (text) => {
        if (!text) return;
        
        // Convert to lowercase for consistency
        const lowerText = text.toLowerCase();
        
        // Extract significant terms using regex patterns
        // 1. Extract noun phrases (typically 1-3 words)
        const nounPhrases = lowerText.match(/\b[a-z]{3,}(?:\s+[a-z]{3,}){0,2}\b/g) || [];
        
        // 2. Filter to keep only domain-specific and significant terms
        const significantTerms = nounPhrases.filter(phrase => {
            // Skip common words and very short phrases
            if (phrase.length < 5) return false;
            
            const commonWords = ['the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 
                               'are', 'from', 'have', 'has', 'will', 'not', 'but', 'they', 
                               'what', 'when', 'where', 'which', 'who', 'how', 'all', 'been',
                               'can', 'use', 'using', 'used', 'more', 'most', 'some', 'such'];
            
            // Skip phrases that are just common words
            if (commonWords.includes(phrase)) return false;
            
            // Keep phrases that seem domain-specific
            return true;
        });
        
        // Add filtered terms to our keyword set
        for (const term of significantTerms) {
            keywordSet.add(term);
        }
    };
    
    // Process various fields from persona config
    if (personaConfig.description) {
        addKeywordsFromText(personaConfig.description);
    }
    
    if (personaConfig.behaviorInstructions) {
        addKeywordsFromText(personaConfig.behaviorInstructions);
    }
    
    if (personaConfig.functionalDirectives) {
        addKeywordsFromText(personaConfig.functionalDirectives);
    }
    
    // Process the persona name itself - often contains domain hints
    const nameParts = personaName
        .replace(/[_]/g, ' ')  // Replace underscores with spaces
        .replace(/([a-z])([A-Z])/g, '$1 $2')  // Split camelCase
        .toLowerCase()
        .split(' ');
    
    // Add name parts that are substantive
    for (const part of nameParts) {
        if (part.length > 3 && !['the', 'and', 'for'].includes(part)) {
            keywordSet.add(part);
        }
    }
    
    // If available, use LLM to enhance keyword extraction
    try {
        const llmKeywords = await extractKeywordsWithLLM(personaName, personaConfig);
        
        // Add LLM-generated keywords to our set
        for (const keyword of llmKeywords) {
            keywordSet.add(keyword.toLowerCase());
        }
    } catch (error) {
        console.warn(`LLM keyword extraction failed for ${personaName}, continuing with rule-based extraction:`, error.message);
        // Continue with rule-based extraction only
    }
    
    return [...keywordSet];
}

/**
 * Uses the LLM to extract relevant keywords from a persona
 * @param {string} personaName - The name of the persona
 * @param {Object} personaConfig - The configuration for this persona
 * @returns {Promise<string[]>} - Array of extracted keywords
 */
async function extractKeywordsWithLLM(personaName, personaConfig) {
    // Skip LLM processing if no LLM is available
    if (!global.llmModule || !global.llmModule.simpleLLMCall) {
        return [];
    }
    
    // Format persona config for LLM
    const configText = `
Persona Name: ${personaName}
Description: ${personaConfig.description || 'N/A'}
Behavior Instructions: ${personaConfig.behaviorInstructions || 'N/A'}
Functional Directives: ${personaConfig.functionalDirectives || 'N/A'}
Knowledge Constraints: ${personaConfig.knowledgeConstraints || 'N/A'}
Ethical Guidelines: ${personaConfig.ethicalGuidelines || 'N/A'}
Tools: ${personaConfig.tools ? personaConfig.tools.join(', ') : 'N/A'}
Collections: ${personaConfig.collection ? personaConfig.collection.join(', ') : 'N/A'}
`;

    // Create prompt for keyword extraction
    const prompt = `
You are assisting in extracting keywords from a persona configuration that will be used for message routing.
Analyze the following persona configuration and extract 10-20 relevant keywords or short phrases that users might use when they want to interact with this persona.
Focus on domain-specific terminology and common user requests related to this persona's expertise.

${configText}

Provide your answer as a JSON array of strings, like this:
["keyword1", "keyword2", "keyword phrase", ...]

Only include the JSON array in your response, no other text.
`;

    try {
        // Call LLM with the prompt
        const messageData = {
            senderId: 'keyword_extractor',
            recipientId: 'system',
            message: prompt,
            timestamp: new Date().toISOString(),
            status: 'processing'
        };
        
        const response = await global.llmModule.simpleLLMCall(messageData);
        
        if (!response || !response.message) {
            return [];
        }
        
        // Extract JSON array from response
        const responseText = response.message.trim();
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        
        if (!jsonMatch) {
            return [];
        }
        
        // Parse the JSON array
        const keywordsArray = JSON.parse(jsonMatch[0]);
        
        // Validate and return
        if (Array.isArray(keywordsArray)) {
            return keywordsArray;
        }
        
        return [];
    } catch (error) {
        console.error('Error in LLM keyword extraction:', error);
        return [];
    }
}

class QualityControl {
    constructor(llmInstance) {
        this.llm = llmInstance;
        this.maxRetries = process.env.QUALITY_CONTROL_MAX_RETRIES || 2;
        this.personasConfig = llmInstance.personasConfig || {};
    }
    
    async evaluateResponse(userQuery, llmResponse, options = {}) {
        const { 
            context = null,
            queryType = null,
            persona = null,
            classification = null
        } = options;
        
        // Prepare evaluation prompt
        const evaluationPrompt = `
            You are a Quality Control Agent responsible for ensuring responses meet high standards.
            
            USER QUERY: "${userQuery}"
            
            CURRENT LLM RESPONSE: "${llmResponse}"
            
            ${context ? `RELEVANT CONTEXT: ${context}` : ''}
            ${queryType ? `RESPONSE GENERATED USING: ${queryType}` : ''}
            ${persona ? `PERSONA USED: ${persona}` : ''}
            
            Assess this response based on:
            1. Relevance: Does it directly address the user's query?
            2. Accuracy: Is the information correct (based on context if provided)?
            3. Completeness: Does it fully answer all aspects of the query?
            4. Clarity: Is the response clear and well-structured?
            
            Provide your assessment and specific suggestions for improvement.
            Format your response as JSON with the following fields:
            {
                "qualityScore": [0-10], // Overall quality score
                "needsRevision": true/false, // Whether response needs revision
                "issues": ["specific issue 1", "specific issue 2"], // Problems with the response
                "improvementSuggestions": "Detailed suggestions for improvement"
            }
            
            If the response is satisfactory (8+ quality score), set needsRevision to false.
        `;
        
        // Use simpleLLMCall to avoid potential recursion
        const messageData = {
            senderId: 'quality_control_agent',
            recipientId: 'system',
            message: evaluationPrompt,
            timestamp: new Date().toISOString(),
            status: 'processing',
            format: 'json'
        };
        
        const raw = await this.llm.simpleLLMCall(messageData);
        let text = raw.message;

        // Parse response to get evaluation
        try {
            // Test if it is a JSON object
            if (text.startsWith('{') && text.endsWith('}')) {
                // If it looks like a JSON object, return it directly
                return JSON.parse(text);
            }

            // 1) Strip out any Markdown fences or stray backticks
            text = text.replace(/```/g, '');
          
            // 2) Grab the JSON object itself
            const braceMatch = text.match(/\{[\s\S]*\}/);
            if (!braceMatch) {
                console.warn('QC: no JSON object found, falling back.');
                return this._defaultAssessment();
            }
            
            let jsonString = braceMatch[0];
          
            // 3) Escape any literal newlines inside improvementSuggestions
            jsonString = jsonString.replace(
                /("improvementSuggestions"\s*:\s*")([\s\S]*?)(")(\s*,)/,
                (_, prefix, body, quote, comma) => {
                    // replace real breaks with \n
                    const escapedBody = body.replace(/\r?\n/g, '\\n');
                    return `${prefix}${escapedBody}${quote}${comma}`;
                }
            );
          
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Failed to parse quality evaluation response:', error);
            // Return a default assessment
            return this._defaultAssessment();
        }
    }
    
    _defaultAssessment() {
        return {
            qualityScore: 5,
            needsRevision: false,
            issues: ['Error in quality control process'],
            improvementSuggestions: ''
        };
    }
}
class LLMModule {
    constructor() {
        // Initialize conversation history storage
        this.conversationHistory = new Map();
        this.maxContextLength = 10; // Maximum number of messages to keep in context
        this.llmType = process.env.LLM_TYPE || 'ollama';
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.claudeApiKey = process.env.CLAUDE_API_KEY;
        this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
        this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o'; // Default to GPT-4o if not specified
        this.claudeModel = process.env.CLAUDE_MODEL || 'claude-2';
        this.personasConfig = {};
        this.qualityControlEnabled = process.env.QUALITY_CONTROL_ENABLED === 'true';
        this.keywordToPersonaMap = {};
        this.isEnabled = false; // Track if module is properly initialized
        
        // Validate environment configuration before initialization
        if (this.validateEnvironmentConfiguration()) {
            this.initialize();
        } else {
            console.warn('⚠️  LLMModule disabled: Missing required environment configuration');
        }
    }

    /**
     * Validates that the required environment variables are present for the selected LLM type
     * @returns {boolean} true if configuration is valid, false otherwise
     */
    validateEnvironmentConfiguration() {
        if (!this.llmType) {
            console.error('❌ LLM_TYPE environment variable is required');
            return false;
        }

        const llmType = this.llmType.toLowerCase();
        
        switch (llmType) {
            case 'ollama':
                console.log('✅ LLMModule: Using Ollama configuration');
                // Check if basic Ollama environment variables are available
                const ollamaHost = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
                const ollamaInference = process.env.OLLAMA_INFERENCE || 'llama3';
                
                // For now, assume Ollama is configured if environment variables are present
                // The actual connectivity check will happen during initialization
                return true;
                
            case 'openai':
                if (!this.openaiApiKey) {
                    console.error('❌ OPENAI_API_KEY environment variable is required for OpenAI LLM type');
                    return false;
                }
                console.log('✅ LLMModule: Using OpenAI configuration');
                return true;
                
            case 'claude':
                if (!this.claudeApiKey) {
                    console.error('❌ CLAUDE_API_KEY environment variable is required for Claude LLM type');
                    return false;
                }
                console.log('✅ LLMModule: Using Claude configuration');
                return true;
                
            case 'openrouter':
                if (!this.openRouterApiKey) {
                    console.error('❌ OPENROUTER_API_KEY environment variable is required for OpenRouter LLM type');
                    return false;
                }
                console.log('✅ LLMModule: Using OpenRouter configuration');
                return true;
                
            default:
                console.error(`❌ Unsupported LLM_TYPE: ${this.llmType}. Supported types: ollama, openai, claude, openrouter`);
                return false;
        }
    }

    /**
     * Checks if the LLMModule is enabled and properly configured
     * @returns {boolean} true if enabled, false otherwise
     */
    isModuleEnabled() {
        return this.isEnabled;
    }


    async initialize() {
        try {
            // Set redisClient connection options for better stability
            if (redisClient.options) {
                redisClient.options.retry_strategy = (options) => {
                    if (options.error && options.error.code === 'ECONNREFUSED') {
                        // If the Redis server is down, end reconnection attempts
                        return new Error('The Redis server refused the connection');
                    }
                    if (options.total_retry_time > 1000 * 60 * 5) {
                        // End reconnecting after 5 minutes
                        return new Error('Retry time exhausted');
                    }
                    if (options.attempt > 10) {
                        // End reconnecting with built in error
                        return undefined;
                    }
                    // Reconnect after increasing intervals
                    return Math.min(options.attempt * 100, 3000);
                };
            }
    
            console.log('Initializing LLMModule...');
            
            // Step 1: Load personas first (may use cache if available)
            this.personasConfig = await this.loadPersonas();
            console.log(`Personas loaded: ${Object.keys(this.personasConfig).length} personas found`);
            
            // Step 2: Check if we need to initialize the keyword map
            const needsInitialization = await this.needsKeywordMapInitialization();
            
            if (needsInitialization) {
                console.log('Keyword map needs initialization');
                
                // Step 3: Check if personas have changed since last time
                const personasChanged = await this.hasPersonasConfigChanged();
                
                if (personasChanged) {
                    console.log('Personas configuration has changed, rebuilding keyword map');
                    // Full initialization needed
                    await this.initializeKeywordMap();
                } else {
                    console.log('Trying to load keyword map from Redis cache');
                    // Try to load from Redis one more time
                    try {
                        if (redisClient.status !== 'ready') {
                            await redisClient.connect();
                        }
                        
                        const cachedMap = await redisClient.get('keywordToPersonaMap');
                        if (cachedMap) {
                            this.keywordToPersonaMap = JSON.parse(cachedMap);
                            console.log(`Loaded ${Object.keys(this.keywordToPersonaMap).length} keywords from Redis cache`);
                            
                            // Validate the loaded map
                            if (!this.validateKeywordMap()) {
                                console.log('Cached keyword map validation failed, rebuilding');
                                await this.initializeKeywordMap();
                            }
                        } else {
                            console.log('No keyword map in Redis cache, initializing');
                            await this.initializeKeywordMap();
                        }
                    } catch (error) {
                        console.warn('Error loading keyword map from cache:', error.message);
                        console.log('Fallback to keyword map initialization');
                        await this.initializeKeywordMap();
                    }
                }
            } else {
                console.log('Using existing keyword map, skipping initialization');
                
                // Quick validation of the loaded map
                if (!this.validateKeywordMap()) {
                    console.log('Existing keyword map validation failed, rebuilding');
                    await this.initializeKeywordMap();
                }
            }
            
            console.log('LLMModule initialization complete');
            this.isEnabled = true; // Mark as enabled after successful initialization
        } catch (error) {
            console.error('Error during LLMModule initialization:', error);
            this.isEnabled = false; // Ensure module is marked as disabled on error
        }
    }
    // Initialize quality control after the instance is fully constructed
    initQualityControl() {
        this.qualityControl = new QualityControl(this);
        return this.qualityControl;
    }

    /**
 * Checks if the keywordToPersonaMap needs to be initialized
 * @returns {Promise<boolean>} - True if the map needs initialization, false otherwise
 */
async needsKeywordMapInitialization() {
    // Check if we already have a map in memory
    if (this.keywordToPersonaMap && Object.keys(this.keywordToPersonaMap).length > 0) {
        return false;
    }
    
    // Check if we have a map in Redis cache
    try {
        if (redisClient.status !== 'ready') {
            try {
                await redisClient.connect();
            } catch (connectionError) {
                console.warn('Redis connection failed while checking keyword map:', connectionError.message);
                return true; // Need to initialize if we can't connect to Redis
            }
        }
        
        const cachedMap = await redisClient.get('keywordToPersonaMap');
        if (cachedMap) {
            try {
                // Verify it's valid JSON
                const parsedMap = JSON.parse(cachedMap);
                if (Object.keys(parsedMap).length > 0) {
                    // We have a valid map in Redis, load it instead of initializing
                    this.keywordToPersonaMap = parsedMap;
                    console.log(`Loaded ${Object.keys(this.keywordToPersonaMap).length} keywords from Redis`);
                    return false;
                }
            } catch (parseError) {
                console.warn('Error parsing cached keyword map:', parseError.message);
                return true; // Need to initialize if cached data is corrupt
            }
        }
    } catch (redisError) {
        console.warn('Error checking Redis for keyword map:', redisError.message);
    }
    
    // If we get here, we need to initialize
    return true;
}

/**
 * Checks if the personas configuration has changed
 * @returns {Promise<boolean>} - True if personas have changed, false otherwise
 */
async hasPersonasConfigChanged() {
    try {
        const personaFile = path.join(process.env.CONFIG_DIR, 'personas.json');
        
        // Calculate current file hash
        const fileData = fs.readFileSync(personaFile, 'utf-8');
        const currentHash = crypto.createHash('md5').update(fileData).digest('hex');
        
        // Check if Redis has a stored hash
        if (redisClient.status !== 'ready') {
            try {
                await redisClient.connect();
            } catch (connectionError) {
                console.warn('Redis connection failed while checking personas hash:', connectionError.message);
                return true; // Assume changed if we can't connect to Redis
            }
        }
        
        const cachedHash = await redisClient.get('personasConfig_hash');
        if (cachedHash && cachedHash === currentHash) {
            return false; // No change
        }
        
        return true; // Changed or no cached hash
    } catch (error) {
        console.warn('Error checking if personas config changed:', error.message);
        return true; // Assume changed if there's an error
    }
}

/**
 * Validates the keywordToPersonaMap against current personas
 * Ensures all personas referenced in the map exist in the current config
 * @returns {boolean} - True if the map is valid, false otherwise
 */
validateKeywordMap() {
    if (!this.keywordToPersonaMap || Object.keys(this.keywordToPersonaMap).length === 0) {
        return false; // Empty map is not valid
    }
    
    if (!this.personasConfig || Object.keys(this.personasConfig).length === 0) {
        return false; // No personas to validate against
    }
    
    // Check a sample of keywords to ensure they point to valid personas
    const sampleSize = Math.min(20, Object.keys(this.keywordToPersonaMap).length);
    const sampleKeys = Object.keys(this.keywordToPersonaMap).slice(0, sampleSize);
    
    // For each sample, verify the persona exists
    for (const key of sampleKeys) {
        const persona = this.keywordToPersonaMap[key];
        if (!this.personasConfig[persona]) {
            console.warn(`Keyword map validation failed: ${key} -> ${persona} (persona not found)`);
            return false;
        }
    }
    
    return true; // All samples valid
}
      /**
     * Initializes or refreshes the keyword-to-persona mapping
     * Uses Redis cache to avoid regenerating the mapping if personasConfig hasn't changed
     * Should be called during initialization and when personas are reloaded
     * @returns {Promise<void>}
     */
      async initializeKeywordMap() {
        try {
            // Generate a hash of the personasConfig to detect changes
            const configHash = this.generateConfigHash(this.personasConfig);
            const cacheKey = 'keywordToPersonaMap';
            const hashKey = 'keywordToPersonaMapHash';
            
            // Connect to Redis if not already connected
            if (redisClient.status !== 'ready') {
                try {
                    await redisClient.connect();
                    console.log('Redis connected for keyword mapping');
                } catch (connectionError) {
                    console.warn('Redis connection failed, generating keywords directly:', connectionError.message);
                    this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
                    return;
                }
            }
            
            // Check if we have a cached mapping and if the config hash matches
            let cachedHash, cachedMap;
            try {
                // Get the hash and map from Redis
                cachedHash = await redisClient.get(hashKey);
                cachedMap = await redisClient.get(cacheKey);
                
                // Explicitly log what we got back from Redis
                console.log(`Redis cache check: hashKey exists: ${!!cachedHash}, cacheKey exists: ${!!cachedMap}`);
            } catch (redisError) {
                console.error('Redis error when retrieving cached data:', redisError);
                // Fall back to direct keyword generation
                this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
                return;
            }
            
            // Important check: explicitly handle the case where Redis has no data
            if (!cachedMap || !cachedHash) {
                console.log('Redis cache is empty, generating new keyword mapping from scratch');
                this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
                
                // Store the new mapping in Redis
                try {
                    await redisClient.set(cacheKey, JSON.stringify(this.keywordToPersonaMap));
                    await redisClient.set(hashKey, configHash);
                    console.log('New keyword mapping stored in Redis cache', configHash, cacheKey);
                } catch (storageError) {
                    console.error('Failed to store keyword mapping in Redis:', storageError);
                }
                
                return;
            }
            
            if (cachedHash === configHash) {
                // Config hasn't changed and we have a cached map, use it
                console.log('Using cached keyword mapping from Redis');
                try {
                    this.keywordToPersonaMap = JSON.parse(cachedMap);
                    console.log(`Loaded ${Object.keys(this.keywordToPersonaMap).length} keywords from Redis cache`);
                } catch (parseError) {
                    console.error('Error parsing cached keyword map:', parseError);
                    // Fall back to direct generation if cached data is corrupt
                    this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
                }
            } else {
                // Config has changed
                console.log('Config hash changed, generating updated keyword mapping');
                
                try {
                    // Parse the cached map if it exists
                    const existingMap = cachedMap ? JSON.parse(cachedMap) : {};
                    
                    // If we have existing map data to work with, do incremental update
                    if (Object.keys(existingMap).length > 0) {
                        this.keywordToPersonaMap = await this.generateKeywordToPersonaMapIncremental(existingMap);
                    } else {
                        // No existing map, generate a complete new one
                        this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
                    }
                    
                    // Cache the new mapping and hash
                    await redisClient.set(cacheKey, JSON.stringify(this.keywordToPersonaMap));
                    await redisClient.set(hashKey, configHash);
                    console.log('Updated keyword mapping stored in Redis cache');
                } catch (error) {
                    console.error('Error updating keyword mapping:', error);
                    // Fallback to direct generation
                    this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
                }
            }
            
            // Log success
            console.log(`Keyword mapping initialized with ${Object.keys(this.keywordToPersonaMap).length} keywords`);
        } catch (error) {
            console.error('Failed to initialize keyword mapping:', error);
            // Keep existing mapping if any, or set to empty object
            this.keywordToPersonaMap = this.keywordToPersonaMap || {};
            
            // Always ensure we have keyword data even if everything fails
            if (Object.keys(this.keywordToPersonaMap).length === 0 && this.personasConfig) {
                console.log('Emergency fallback: generating keywords directly');
                this.keywordToPersonaMap = await this.generateKeywordToPersonaMap(this.personasConfig);
            }
        }
    }
    
    /**
     * Generates a hash of the personasConfig to detect changes
     * @param {Object} config - The personas configuration object
     * @returns {string} - A hash representing the config
     */
    generateConfigHash(config) {
        const configString = JSON.stringify(config);
        return crypto.createHash('md5').update(configString).digest('hex');
    }
    
    /**
     * Incrementally updates the keyword map using an existing map as a base
     * Only regenerates keywords for personas that exist in current config
     * @param {Object} existingMap - The existing keyword-to-persona mapping from cache
     * @returns {Promise<Object>} - An updated mapping of keywords to persona names
     */
    async generateKeywordToPersonaMapIncremental(existingMap) {
        if (!this.personasConfig || Object.keys(this.personasConfig).length === 0) {
            console.warn('No personas configuration provided for incremental keyword mapping');
            return existingMap || {};
        }
        
        // Create a clean map with only entries for current personas
        const updatedMap = {};
        
        // First, copy over existing mappings that still point to valid personas
        for (const [keyword, personaName] of Object.entries(existingMap)) {
            if (this.personasConfig[personaName]) {
                updatedMap[keyword] = personaName;
            }
        }
        
        // Then generate keywords for all current personas to ensure completeness
        for (const [personaName, personaConfig] of Object.entries(this.personasConfig)) {
            try {
                // Extract keywords from persona configuration
                const keywords = await extractKeywordsFromPersona(personaName, personaConfig);
                
                // Add each keyword to the map, pointing to this persona
                for (const keyword of keywords) {
                    updatedMap[keyword.toLowerCase()] = personaName;
                }
            } catch (error) {
                console.error(`Error generating keywords for persona ${personaName}:`, error);
                // Continue with other personas even if one fails
            }
        }
        
        return updatedMap;
    }

    /**
     * Generates a keyword-to-persona mapping based on persona configurations
     * This function analyzes persona descriptions and creates a mapping of relevant keywords
     * @param {Object} personasConfig - The personas configuration object
     * @param {Object} existingMap - Optional existing map to update instead of creating a new one
     * @returns {Promise<Object>} - A mapping of keywords to persona names
     */
    async generateKeywordToPersonaMap(personasConfig, existingMap = {}) {
        if (!personasConfig || Object.keys(personasConfig).length === 0) {
            console.warn('No personas configuration provided for keyword mapping');
            return existingMap || {};
        }
        
        // Start with existing map if provided, otherwise empty object
        const keywordMap = { ...existingMap };
        const startTime = Date.now();
        
        // For each persona in the configuration
        for (const [personaName, personaConfig] of Object.entries(personasConfig)) {
            try {
                // Extract keywords from persona configuration
                const keywords = await extractKeywordsFromPersona(personaName, personaConfig);
                
                // Add each keyword to the map, pointing to this persona
                for (const keyword of keywords) {
                    keywordMap[keyword.toLowerCase()] = personaName;
                }
            } catch (error) {
                console.error(`Error generating keywords for persona ${personaName}:`, error);
                // Continue with other personas even if one fails
            }
        }
        
        const endTime = Date.now();
        console.log(`Generated keyword mapping in ${endTime - startTime}ms for ${Object.keys(personasConfig).length} personas`);
        
        return keywordMap;
    }

   /**
 * Loads personas from configuration
 * Uses Redis cache to avoid reloading personas from disk if unchanged
 * @returns {Promise<Object>} - The loaded personas configuration
 */
async loadPersonas() {
    try {
        const cacheKey = 'personasConfig';
        const personaFile = path.join(process.env.CONFIG_DIR, 'personas.json');

        // Try to connect to Redis if not already connected
        let redisConnected = false;
        if (redisClient.status !== 'ready') {
            try {
                await redisClient.connect();
                redisConnected = true;
                console.log('✅ [LLMModule] Redis connected for persona loading');
            } catch (connectionError) {
                console.warn('Redis connection failed for persona loading, reading from file:', connectionError.message);
                redisConnected = false;
            }
        } else {
            redisConnected = true;
        }

        // Check if the file has been modified since last load (if possible)
        let fileModified = true;
        let fileHash = null;
        try {
            // Get file stats and calculate hash
            const fileStats = fs.statSync(personaFile);
            const fileData = fs.readFileSync(personaFile, 'utf-8');
            fileHash = crypto.createHash('md5').update(fileData).digest('hex');
            
            // Check if we have a cached hash in Redis
            if (redisConnected) {
                const cachedHash = await redisClient.get(`${cacheKey}_hash`);
                if (cachedHash === fileHash) {
                    fileModified = false;
                    console.log('✅ [LLMModule] Personas file unchanged');
                }
            }
        } catch (fileError) {
            console.error('Error checking personas file:', fileError);
        }

        // Try to get cached personas if Redis is connected and file hasn't changed
        if (redisConnected && !fileModified) {
            try {
                const cachedPersonas = await redisClient.get(cacheKey);
                if (cachedPersonas) {
                    console.log(`✅ [LLMModule] Loaded personasConfig from Redis cache :  ${cachedPersonas.length}`);
                    const parsedPersonas = JSON.parse(cachedPersonas);
                    
                    // Check if we already have a keyword map in memory
                    const hasKeywordMap = this.keywordToPersonaMap && 
                                         Object.keys(this.keywordToPersonaMap).length > 0;
                                         
                    // Check if we have a cached keyword map in Redis
                    let hasCachedKeywordMap = false;
                    if (redisConnected) {
                        const cachedMapExists = await redisClient.get('keywordToPersonaMap');
                        hasCachedKeywordMap = !!cachedMapExists;
                    }
                    
                    // Only trigger keyword map initialization if:
                    // 1. We don't have it in memory AND
                    // 2. We don't have it cached in Redis
                    if (!hasKeywordMap && !hasCachedKeywordMap) {
                        console.log('No keyword map found, will initialize after persona loading');
                        // setTimeout(() => {
                        //     this.initializeKeywordMap().catch(error => {
                        //         console.error('Async keyword map initialization failed:', error);
                        //     });
                        // }, 0);
                    } else {
                        console.log('Keyword map already available, skipping initialization');
                    }

                    return parsedPersonas;
                }
            } catch (cacheError) {
                console.warn('Error loading from Redis cache:', cacheError);
            }
        }

        // If cache miss or Redis unavailable or file modified, load from disk
        console.log('Loading personas from file');
        const data = fs.readFileSync(personaFile, 'utf-8');
        const personasConfig = JSON.parse(data);

        // Save personasConfig into Redis if connected
        if (redisConnected) {
            try {
                await redisClient.set(cacheKey, JSON.stringify(personasConfig));
                // Store the file hash for future comparisons
                if (fileHash) {
                    await redisClient.set(`${cacheKey}_hash`, fileHash);
                }
                console.log('✅ [LLMModule] Saved personasConfig to Redis cache');
            } catch (saveError) {
                console.warn('Error saving to Redis cache:', saveError);
            }
        }

        // Since the file was modified or newly loaded, we need to update the keyword map
        console.log('Personas modified, will update keyword map');
        setTimeout(() => {
            this.initializeKeywordMap().catch(error => {
                console.error('Async keyword map initialization failed:', error);
            });
        }, 0);
          
        return personasConfig;
    } catch (error) {
        logger.error('Failed to load personas:', error);
        return {};
    }
}
    

    // Add message to conversation history
    addToHistory(sessionId, message, role = 'user') {
        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        
        const history = this.conversationHistory.get(sessionId);
        
        // If adding a system message, check if we already have one
        if (role === 'system') {
            // Look for existing system message
            const existingSystemIndex = history.findIndex(msg => msg.role === 'system');
            if (existingSystemIndex >= 0) {
                // Replace existing system message
                history[existingSystemIndex].content = message;
                this.conversationHistory.set(sessionId, history);
                return;
            }
            // If no existing system message, add it to the beginning
            history.unshift({ role, content: message });
        } else {
            // For regular messages, add to the end
            history.push({ role, content: message });
            
            // Maintain context window, but preserve system message if present
            if (history.length > this.maxContextLength * 2) { // *2 because we store both user and assistant messages
                // Check if first message is a system message
                const hasSystemFirst = history.length > 0 && history[0].role === 'system';
                
                if (hasSystemFirst) {
                    // Keep system message, remove the next oldest pair
                    const systemMsg = history[0];
                    history.splice(1, 2); // Remove oldest message pair (excluding system)
                    
                    // Ensure system message stays at position 0
                    if (history[0].role !== 'system') {
                        history.unshift(systemMsg);
                    }
                } else {
                    // No system message, standard pruning
                    history.splice(0, 2); // Remove oldest message pair
                }
            }
        }
        
        this.conversationHistory.set(sessionId, history);
    }

    // Get conversation history for a session
    getHistory(sessionId) {
        return this.conversationHistory.get(sessionId) || [];
    }
    
    getPersonasWithDescriptions() {
        return Object.entries(this.personasConfig).map(([persona, config]) => ({
            persona,
            description: config.description || 'No description provided'
        }));
    }
      
   // Updated detectRequestedPersona method that uses dynamic keyword mapping
async detectRequestedPersona(message) {
    if (!message) return { requestedPersona: null, cleanedMessage: message };
    
    // Get all persona names to check against user message
    const personaNames = Object.keys(this.personasConfig);
    if (personaNames.length === 0) {
        return { requestedPersona: null, cleanedMessage: message };
    }
    
    // If keyword map is empty, check if it's available in Redis before initialization
    if (Object.keys(this.keywordToPersonaMap || {}).length === 0) {
        try {
            // Try to load from Redis first instead of rebuilding
            if (redisClient.status === 'ready') {
                const cachedMap = await redisClient.get('keywordToPersonaMap');
                if (cachedMap) {
                    this.keywordToPersonaMap = JSON.parse(cachedMap);
                    console.log(`Loaded ${Object.keys(this.keywordToPersonaMap).length} keywords from Redis for persona detection`);
                } else {
                    // Only initialize if we couldn't load from cache
                    console.log('No keyword map in cache, initializing for persona detection');
                    await this.initializeKeywordMap();
                }
            } else {
                // Redis not ready, initialize directly
                console.log('Redis not ready, initializing keyword map for persona detection');
                await this.initializeKeywordMap();
            }
        } catch (error) {
            console.warn('Error loading keyword map for persona detection:', error.message);
            // Continue with empty map - we'll use fallback methods
        }
    }

    // Step 1: Check for explicit personas mentioned in the message using regex patterns
    // Direct requests
    const requestPatterns = [
        // Direct requests
        /I\s+need\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:to|that)/i,
        /I\s+want\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:to|that)/i,
        /(?:get|give)\s+me\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:to|that)/i,
        /can\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+help/i,
        /let\s+(?:a|an|the)\s+([a-zA-Z\s]+)\s+(?:handle|answer)/i,
        
        // Persona-first patterns
        /^([a-zA-Z\s]+)\s*[:,.]\s*(.*)/i,
        /^(?:as|like)\s+(?:a|an|the)\s+([a-zA-Z\s]+)[,.:]\s*(.*)/i
    ];
    
    // Check each pattern for direct persona requests
    for (const pattern of requestPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            const potentialPersona = match[1].trim().toLowerCase();
            
            // Find best matching persona - look for exact matches first
            for (const personaName of personaNames) {
                if (personaName.toLowerCase() === potentialPersona) {
                    // Exact match - high confidence
                    const cleanedMessage = this.removePersonaRequest(message, match[0]);
                    return { 
                        requestedPersona: personaName, 
                        cleanedMessage,
                        confidence: 'high',
                        method: 'exact_name_match'
                    };
                }
            }
            
            // Find partial matches with a high threshold to avoid false positives
            let bestMatch = null;
            let bestMatchScore = 0;
            
            for (const personaName of personaNames) {
                // Check for substring relationship
                if (personaName.toLowerCase().includes(potentialPersona) ||
                    potentialPersona.includes(personaName.toLowerCase())) {
                    
                    const score = this.calculateMatchScore(personaName.toLowerCase(), potentialPersona);
                    
                    // Higher threshold (0.7) to avoid false positives
                    if (score > bestMatchScore && score > 0.7) {
                        bestMatchScore = score;
                        bestMatch = personaName;
                    }
                }
            }
            
            if (bestMatch) {
                const cleanedMessage = this.removePersonaRequest(message, match[0]);
                return { 
                    requestedPersona: bestMatch, 
                    cleanedMessage,
                    confidence: 'medium',
                    method: 'partial_name_match' 
                };
            }
        }
    }
    
    // Step 2: Check for keyword associations using our dynamic keyword map
    // Skip if we don't have a keyword map to avoid unnecessary work
    if (this.keywordToPersonaMap && Object.keys(this.keywordToPersonaMap).length > 0) {
        // Create a weighted scoring system for keywords
        const personaScores = {};
        const normalizedMessage = message.toLowerCase();
        
        // Initialize scores for personas
        for (const persona of personaNames) {
            personaScores[persona] = 0;
        }
        
        // Score based on keyword presence
        for (const [keyword, persona] of Object.entries(this.keywordToPersonaMap)) {
            if (normalizedMessage.includes(keyword) && personaNames.includes(persona)) {
                // Add points to this persona if keyword found
                personaScores[persona] = (personaScores[persona] || 0) + 1;
                
                // If the keyword appears at the beginning or is a significant part of the request,
                // give it more weight
                if (normalizedMessage.startsWith(keyword) || 
                    normalizedMessage.includes(`about ${keyword}`) ||
                    normalizedMessage.includes(`for ${keyword}`)) {
                    personaScores[persona] += 1;
                }
            }
        }
        
        // Find persona with highest score
        let highestScore = 0;
        let mostLikelyPersona = null;
        
        for (const [persona, score] of Object.entries(personaScores)) {
            if (score > highestScore) {
                highestScore = score;
                mostLikelyPersona = persona;
            }
        }
        
        // Only return a keyword-based match if the score is at least 2
        // This helps avoid false positives from casual mentions
        if (mostLikelyPersona && highestScore >= 4) {
            return { 
                requestedPersona: mostLikelyPersona, 
                cleanedMessage: message,
                confidence: 'medium',
                method: 'keyword_match',
                score: highestScore
            };
        }
    }
    
    // Step 3: If no clear match from keywords, use content analysis
    // This is a fallback that will use a more robust approach
    
    try {
        // Use the existing selectPersona method as fallback
        const {persona : selectedPersona } = await this.selectPersona(message, this.getPersonasWithDescriptions());
        
        return { 
            requestedPersona: selectedPersona, 
            cleanedMessage: message,
            confidence: 'low',
            method: 'content_analysis'
        };
    } catch (error) {
        console.error('Error in advanced persona detection:', error);
        return { requestedPersona: null, cleanedMessage: message };
    }
}
    calculateMatchScore(str1, str2) {
        if (!str1 || !str2) return 0;
        
        // Convert to lowercase for case-insensitive matching
        const lowerStr1 = str1.toLowerCase();
        const lowerStr2 = str2.toLowerCase();
        
        // Check for exact match
        if (lowerStr1 === lowerStr2) return 1.0;
        
        // Check if one is a substring of the other
        if (lowerStr1.includes(lowerStr2)) {
            // Calculate how much of str1 is covered by str2
            return lowerStr2.length / lowerStr1.length;
        }
        
        if (lowerStr2.includes(lowerStr1)) {
            // Calculate how much of str2 is covered by str1
            return lowerStr1.length / lowerStr2.length;
        }
        
        // Word-level similarity for multi-word personas
        const words1 = lowerStr1.split(/\s+/);
        const words2 = lowerStr2.split(/\s+/);
        
        // Count matching words
        let matchCount = 0;
        for (const word1 of words1) {
            if (word1.length <= 2) continue; // Skip very short words
            
            for (const word2 of words2) {
                if (word2.length <= 2) continue; // Skip very short words
                
                if (word1 === word2 || 
                    word1.includes(word2) || 
                    word2.includes(word1)) {
                    matchCount++;
                    break;
                }
            }
        }
        
        // Calculate word-level similarity score
        const totalUniqueWords = new Set([...words1, ...words2]).size;
        if (totalUniqueWords === 0) return 0;
        
        return matchCount / totalUniqueWords;
    }

     // Enhanced removePersonaRequest function to better handle persona removal
     removePersonaRequest(message, matchedRequest) {
        if (!matchedRequest || !message) return message;
        
        // Replace the matched request with empty string
        const cleanedMessage = message.replace(matchedRequest, '').trim();
        
        // If there's content remaining, return it, otherwise return original
        // (this avoids completely emptying the message)
        if (cleanedMessage.length > 0) {
            // Check if the cleaned message starts with common conjunctions
            // and remove them for better flow
            const conjunctions = [', ', ': ', '. ', '? ', '! ', ' - '];
            let finalMessage = cleanedMessage;
            
            for (const conj of conjunctions) {
                if (finalMessage.startsWith(conj)) {
                    finalMessage = finalMessage.substring(conj.length).trim();
                }
            }
            
            return finalMessage;
        }
        
        return message;
    }

    jsonToMarkdown(jsonObj) {
        let markdown = '';

        function convertToMarkdown(obj, level = 0) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const indent = '  '.repeat(level);
                    if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && obj[key] !== null) {
                        markdown += `${indent}### ${key}:\n`;
                        convertToMarkdown(obj[key], level + 1);
                    } else if (Array.isArray(obj[key])) {
                        markdown += `${indent}### ${key}:\n`;
                        obj[key].forEach(item => {
                            markdown += `${indent}- ${JSON.stringify(item)}\n`;
                        });
                    } else {
                        markdown += `${indent}- **${key}:** ${obj[key]}\n`;
                    }
                }
            }
        }

        convertToMarkdown(jsonObj);

        return markdown;
    }

/**
 * Enhanced version of selectPersona that can also provide direct answers
 * Takes in the user's context (account info, orders, etc.) and determines if it can
 * answer directly or should route to a specialized persona
 * 
 * @param {string} message - The user's message
 * @param {Array} personaList - List of available personas with descriptions
 * @param {Object} options - Additional options
 * @param {Object} options.userContext - User-specific context (orders, account info, etc.)
 * @param {string} options.sessionId - User's session ID
 * @returns {Promise<Object>} - Either {persona: personaName} or {directAnswer: answerText}
 */
async selectPersona(message, personaList, options = {}) {
    const { userContext = null, sessionId = null } = options;
    
    if (!personaList || personaList.length === 0) {
        logger.warn('No personas available for selection');
        
        // If we have context, we might be able to answer directly even without personas
        if (userContext) {
            const directAnswer = await this.generateDirectAnswer(message, userContext, sessionId);
            if (directAnswer) {
                return { directAnswer };
            }
        }
        
        return { persona: null };
    }

    const userInformation = this.jsonToMarkdown(userContext);
    console.log('User Context:', userInformation);
    // Format the context information if available
    let contextInfo = '';
    if (userContext) {
        try {
            contextInfo += `\n\nCustomer Information:\n${userInformation}`;
         
        } catch (error) {
            logger.warn('Error formatting user context:', error);
            // Continue without context if there's an error
        }
    }

    // Create a complete message data object with all required fields
    const messageDataCopy = { 
        senderId: sessionId || 'persona_selector', 
        recipientId: 'system',
        message: '',  // Will be populated below
        groupName: null,
        timestamp: new Date().toISOString(),
        status: 'processing'
    };

    let personaListStr = JSON.stringify(personaList, null, 2);
    const llmPrompt = `
    You are a smart routing agent that can either select a specialized persona to handle a query OR answer directly.
    
    Each persona has a name and a brief description of its expertise:
    
    ${personaListStr}
    
    User's question: "${message}"
    ${contextInfo ? `\nUser Context Information:${contextInfo}` : ''}
    
    Instructions:
    1. First, determine if you can answer the user's question DIRECTLY using the provided context information.
    2. If you CAN answer directly with high confidence, respond with a JSON object in this format, Important your ANSWER should be in markdown format:
       {"decision": "direct_answer", "answer": "Your complete answer here"}
    3. If you CANNOT answer directly or the query would benefit from specialized handling, select the most suitable persona from the list and respond with a JSON object in this format:
       {"decision": "use_persona", "persona": "exact_persona_name_from_list"}
    
    Consider these factors:
    - Account-specific questions about orders, refunds, or user data should be answered directly when possible
    - Account, order or refunds updates or changes should be routed to the appropriate persona
    - Technical or complex questions should be routed to specialized personas
    - General questions that require domain expertise should be routed to personas
    - Simple factual questions based on the user's data should be answered directly
    
    Your response must be valid JSON, nothing else.
    `;

    messageDataCopy.message = llmPrompt;

    console.log('Persona selection prompt:', llmPrompt);
    
    try {
        // Use a simpler LLM call that doesn't add to the main conversation history
        const response = await this.simpleLLMCall(messageDataCopy);
        
        if (!response || !response.message) {
            logger.warn('No response from persona selector, using default persona');
            // Use the first persona as default if available
            return { persona: personaList[0]?.persona || null };
        }
        
        // Try to parse JSON response
        try {
            const responseText = response.message.trim();
            // Extract JSON if it's embedded in other text
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
            
            const result = JSON.parse(jsonStr);
            
            if (result.decision === "direct_answer" && result.answer) {
                logger.info(`Providing direct answer based on context`);
                return { directAnswer: result.answer };
            } else if (result.decision === "use_persona" && result.persona) {
                const personaName = result.persona;
                
                // Verify the persona exists in our config
                if (this.personasConfig[personaName]) {
                    logger.info(`Selected persona: ${personaName}`);
                    return { persona: personaName };
                } else {
                    // Try to find a close match
                    const closestPersona = this.findClosestPersona(personaName);
                    if (closestPersona) {
                        logger.info(`Using closest matching persona: ${closestPersona}`);
                        return { persona: closestPersona };
                    }
                    
                    logger.warn(`Selected persona "${personaName}" not found in config, using default`);
                    return { persona: personaList[0]?.persona || null };
                }
            } else {
                // Invalid or unexpected format, fall back to default
                logger.warn('Invalid response format from persona selector');
                return { persona: personaList[0]?.persona || null };
            }
        } catch (jsonError) {
            logger.warn('Error parsing JSON response from persona selector:', jsonError);
            
            // Fallback to the original logic if JSON parsing fails
            let personaName = response.message.trim();
            const bracketMatch = personaName.match(/<([^>]+)>/);
            if (bracketMatch) {
                personaName = bracketMatch[1].trim();
            } else {
                personaName = personaName.split('\n')[0].trim();
            }
            
            // Verify the persona exists
            if (this.personasConfig[personaName]) {
                return { persona: personaName };
            } else {
                // Try to find a close match
                const closestPersona = this.findClosestPersona(personaName);
                if (closestPersona) {
                    return { persona: closestPersona };
                }
                
                return { persona: personaList[0]?.persona || null };
            }
        }
    } catch (error) {
        logger.error('Error selecting persona:', error);
        // Use the first persona as default if available
        return { persona: personaList[0]?.persona || null };
    }
}

/**
 * Attempts to generate a direct answer to the user's query using the provided context
 * @param {string} message - The user's message
 * @param {Object} userContext - User-specific context
 * @param {string} sessionId - User's session ID
 * @returns {Promise<string|null>} - Direct answer or null if can't answer
 */
async generateDirectAnswer(message, userContext, sessionId) {
    // Create a direct answer prompt
    const directAnswerPrompt = `
    You are a helpful assistant with access to the user's account information.
    
    User's question: "${message}"
    
    User's Information:
    ${JSON.stringify(userContext, null, 2)}
    
    Instructions:
    1. If you can confidently answer the user's question using ONLY the provided context, provide a complete, helpful response.
    2. If you cannot answer with the provided context or the question requires additional expertise, respond with "NEED_SPECIALIZED_PERSONA".
    3. Focus on factual information from the context - orders, account details, user profile, etc.
    4. Be helpful, concise, and accurate.
    
    Your response should either be a direct answer to the user's question OR exactly "NEED_SPECIALIZED_PERSONA" if you cannot answer confidently.
    `;
    
    console.log('Direct answer prompt:', directAnswerPrompt);
    const messageData = { 
        senderId: sessionId || 'direct_answer_agent', 
        recipientId: 'system',
        message: directAnswerPrompt,
        timestamp: new Date().toISOString(),
        status: 'processing'
    };
    
    try {
        const response = await this.simpleLLMCall(messageData);
        
        if (!response || !response.message) {
            logger.warn('No response from direct answer generator');
            return null;
        }
        
        const answer = response.message.trim();
        
        // If the LLM indicates it needs a specialized persona, return null
        if (answer === 'NEED_SPECIALIZED_PERSONA' || answer.includes('NEED_SPECIALIZED_PERSONA')) {
            logger.info('Direct answer not possible, need specialized persona');
            return null;
        }
        
        // Otherwise, return the direct answer
        logger.info('Generated direct answer from context');
        return answer;
    } catch (error) {
        logger.error('Error generating direct answer:', error);
        return null;
    }
}
    
    // Helper method to find the closest persona name match
    findClosestPersona(personaName) {
        if (!personaName) return null;
        
        // Convert to lowercase for case-insensitive matching
        const lowerPersonaName = personaName.toLowerCase();
        
        // Check if any persona name contains this string
        for (const [name, _] of Object.entries(this.personasConfig)) {
            if (name.toLowerCase() === lowerPersonaName) {
                return name; // Exact match (case-insensitive)
            }
        }
        
        // Check if this string is contained in any persona name
        for (const [name, _] of Object.entries(this.personasConfig)) {
            if (name.toLowerCase().includes(lowerPersonaName) || 
                lowerPersonaName.includes(name.toLowerCase())) {
                return name; // Partial match
            }
        }
        
        return null; // No match found
    }

    async getLLMInstance(model = null, options = {}) {
        const { ChatOllama } = require('@langchain/ollama');
        const { ChatOpenAI } = require('@langchain/openai');

        // Allow overriding of LLM type and other settings via options
        const { type, baseUrl, ...llmOptions } = options || {};
        const llmType = (type || this.llmType || 'ollama').toLowerCase();

        // Default to environment model if none supplied
        if (!model) {
            // Use a code-optimized model by default
            model = process.env.OLLAMA_INFERENCE || 'codellama:13b-instruct';
        }

        switch (llmType) {
            case 'ollama':
                try {
                    return new ChatOllama({
                        baseUrl: baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
                        model,
                        temperature: 0.3,
                        ...llmOptions
                    });
                } catch (error) {
                    console.error('Error creating ChatOllama instance:', error);
                    // Improved fallback implementation
                    return {
                        call: async (messages) => {
                            const messageData = {
                                senderId: 'rag_system',
                                recipientId: 'AI_Assistant',
                                message: messages[messages.length - 1].content,
                                timestamp: new Date().toISOString(),
                                status: 'processing'
                            };
                            const response = await ollamaModule.processMessage(messageData, [], { model, ...llmOptions });
                            return response.message || '';
                        }
                    };
                }
            case 'openai':
                if (!this.openaiApiKey) {
                    throw new Error("Missing OpenAI API Key");
                }
                try {
                    return new ChatOpenAI({
                        modelName: this.openaiModel,
                        openAIApiKey: this.openaiApiKey,
                        temperature: 0.3,
                        ...llmOptions
                    });
                } catch (error) {
                    console.error('Error creating ChatOpenAI instance:', error);
                    return {
                        call: async (messages) => {
                            const response = await this.callOpenAI(messages);
                            return response.message || '';
                        }
                    };
                }
            default:
                throw new Error(`Unsupported LLM type: ${llmType}`);
        }
    }
    

    // Simple LLM call for internal use (persona selection) that doesn't affect the main conversation
    async simpleLLMCall(messageData, options = {}) {
        try {
            // Ensure all required fields are present to prevent DB errors
            const safeMessageData = {
                senderId: messageData.senderId || 'persona_selector',
                recipientId: messageData.recipientId || 'system',
                message: messageData.message,
                groupName: messageData.groupName || null,
                timestamp: messageData.timestamp || new Date().toISOString(),
                status: 'processing',
                format: messageData.format || 'text'
            };
            
            const llmType = (options.type || this.llmType).toLowerCase();
            const llmOpts = options.llmOptions || options;

            switch (llmType) {
                case 'ollama':
                    // Pass empty history to avoid affecting main conversation
                    return await ollamaModule.processMessage(safeMessageData, [], llmOpts);
                case 'openai':
                    return await this.callOpenAI([{ role: 'user', content: safeMessageData.message }]);
                case 'claude':
                    return await this.callClaude([{ role: 'user', content: safeMessageData.message }]);
                case 'openrouter':
                    return await this.callOpenRouter([{ role: 'user', content: safeMessageData.message }]);
                default:
                    throw new Error(`Unsupported LLM type for persona selection: ${llmType}`);
            }
        } catch (error) {
            logger.error('Error in simple LLM call:', error);
            // Return a fallback response instead of throwing
            return {
                senderId: 'AI_Assistant',
                recipientId: messageData.senderId || 'user',
                message: 'default', // Use a default persona name
                status: 'delivered'
            };
        }
    }

    async processMessage(messageData) {
        logger.info(`Processing message from ${messageData.senderId}`);
        
        try {
            if (!messageData || !messageData.senderId || !messageData.message) {
                throw new Error('Invalid message data');
            }
            
            // Initialize conversation history if needed
            if (!this.conversationHistory.has(messageData.senderId)) {
                this.conversationHistory.set(messageData.senderId, []);
            }
            
            // Store the original user message
            const originalMessage = messageData.message;
            
            // Step 1: Check if user is explicitly requesting a specific persona
            const { requestedPersona, cleanedMessage } = this.detectRequestedPersona(originalMessage);
            
            // Step 2: If user didn't request a specific persona, select one automatically
            let personaName = requestedPersona;
            if (!personaName) {
                const personaList = this.getPersonasWithDescriptions();
                personaName = await this.selectPersona(originalMessage, personaList);
            } else {
                logger.info(`User explicitly requested persona: ${personaName}`);
            }
            
            // Step 3: Build the persona-enhanced prompt if a persona was selected
            let enhancedMessage;
            let messageToProcess;
            
            if (personaName) {
                // If we found a persona request, use the cleaned message
                messageToProcess = requestedPersona ? cleanedMessage : originalMessage;
                const personaPrompt = buildPersonaPrompt(this.personasConfig[personaName]);
                
                if (personaPrompt) {
                    // Format the enhanced message with the persona instructions
                    enhancedMessage = `<s>\n${personaPrompt}\n</s>\n\nUser message: ${messageToProcess}`;
                    logger.info(`Enhanced message with persona: ${personaName}`);
                } else {
                    enhancedMessage = messageToProcess;
                }
            } else {
                enhancedMessage = originalMessage;
                messageToProcess = originalMessage;
            }
            
            // Step 4: Add the user's original message to conversation history
            this.addToHistory(messageData.senderId, originalMessage, 'user');
            
            // Step 5: Create a modified message data object for the LLM call
            const enhancedMessageData = {
                ...messageData,
                message: enhancedMessage,
                // Track which persona was used for logging/debugging
                _personaUsed: personaName || 'none',
                _originalMessage: originalMessage,
                _processedMessage: messageToProcess
            };
            
             const initialResponse = await this.callLLM(enhancedMessageData, messageData.llmOptions || {});
        
            // New Step 7: Apply quality control
            if (this.qualityControlEnabled) {
                console.log('Applying quality control to response');
                const improvedResponse = await this.qualityControl.improveResponse(
                    messageToProcess, // Original user query
                    initialResponse.message, // Initial LLM response
                    {
                        persona: personaName, // The persona used
                        sessionId: messageData.senderId // Session ID for tracking
                    }
                );
                
                // Replace the response message with the improved version
                initialResponse.message = improvedResponse.finalResponse;
                
                // Add metadata about quality control
                initialResponse._qualityControlInfo = {
                    applied: true,
                    attempts: improvedResponse.improvementAttempts,
                    finalScore: improvedResponse.finalEvaluation?.qualityScore || 'unknown'
                };
                
                console.log(`Quality control: Response improved after ${improvedResponse.improvementAttempts} attempts`);
            } else {
                // Add metadata indicating quality control was not applied
                initialResponse._qualityControlInfo = {
                    applied: false
                };
            }
            
            return initialResponse;
            
        } catch (error) {
            logger.error('Error processing message:', error);
            throw error;
        }
    }

    async callLLM(messageData, options = {}) {
        const llmType = (options.type || this.llmType).toLowerCase();
        logger.info(`Calling LLM (${llmType}) for ${messageData.senderId}`);
        
        // Ensure messageData has all required fields to prevent DB errors
        const safeMessageData = {
            senderId: messageData.senderId || 'user',
            recipientId: messageData.recipientId || 'AI_Assistant',
            message: messageData.message || '',
            groupName: messageData.groupName || null,
            timestamp: messageData.timestamp || new Date().toISOString(),
            status: messageData.status || 'processing',
            format: messageData.format || 'text'
        };
        
        try {
            if (!llmType) {
                throw new Error('LLM type not configured');
            }
            
            // Note: We're NOT adding the enhanced message to history here
            // The original user message was already added in processMessage()
            
            // Process based on LLM type
            let response;
            
            switch (llmType) {
                case 'ollama':
                    const ollamaHistory = this.getHistory(safeMessageData.senderId);
                    response = await ollamaModule.processMessage(
                        safeMessageData,
                        ollamaHistory,
                        options.llmOptions || options
                    );
                    break;
                    
                case 'openai':
                    const openaiHistory = this.getHistory(safeMessageData.senderId);
                    // For OpenAI, we need to add the enhanced message right before calling
                    const tempOpenAIHistory = [...openaiHistory];
                    if (tempOpenAIHistory.length > 0) {
                        tempOpenAIHistory.pop(); // Remove the original user message
                    }
                    tempOpenAIHistory.push({ role: 'user', content: safeMessageData.message }); // Add enhanced message
                    response = await this.callOpenAI(tempOpenAIHistory);
                    break;
                    
                case 'claude':
                    const claudeHistory = this.getHistory(safeMessageData.senderId);
                    // Similar approach for Claude
                    const tempClaudeHistory = [...claudeHistory];
                    if (tempClaudeHistory.length > 0) {
                        tempClaudeHistory.pop(); // Remove the original user message
                    }
                    tempClaudeHistory.push({ role: 'user', content: safeMessageData.message }); // Add enhanced message
                    response = await this.callClaude(tempClaudeHistory);
                    break;
                    
                case 'openrouter':
                    const openRouterHistory = this.getHistory(safeMessageData.senderId);
                    // And for OpenRouter
                    const tempOpenRouterHistory = [...openRouterHistory];
                    if (tempOpenRouterHistory.length > 0) {
                        tempOpenRouterHistory.pop(); // Remove the original user message
                    }
                    tempOpenRouterHistory.push({ role: 'user', content: safeMessageData.message }); // Add enhanced message
                    response = await this.callOpenRouter(tempOpenRouterHistory);
                    break;
                default:
                    throw new Error(`Unsupported LLM type: ${llmType}`);
            }
            
            // Make sure response is well-formed
            if (!response) {
                throw new Error('No response from LLM');
            }
            
            // Ensure all required fields are present
            const safeResponse = {
                senderId: response.senderId || 'AI_Assistant',
                recipientId: response.recipientId || safeMessageData.senderId,
                message: response.message || 'Sorry, I could not generate a response.',
                groupName: response.groupName || safeMessageData.groupName,
                timestamp: response.timestamp || new Date().toISOString(),
                status: response.status || 'delivered'
            };
            
            // Add to history only after ensuring the response is valid
            this.addToHistory(safeMessageData.senderId, safeResponse.message, 'assistant');
            
            return safeResponse;
            
        } catch (error) {
            logger.error('Error calling LLM:', error);
            
            // Return a graceful error response instead of throwing
            return {
                senderId: 'AI_Assistant',
                recipientId: safeMessageData.senderId,
                message: 'I apologize, but I encountered an error processing your request. Please try again.',
                groupName: safeMessageData.groupName,
                timestamp: new Date().toISOString(),
                status: 'error'
            };
        }
    }

    async callOpenAI(messages) {
        if (!this.openaiApiKey) {
            throw new Error('OpenAI API key not configured');
        }

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: this.openaiModel,
                    messages: messages
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openaiApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;

            return {
                senderId: 'AI_Assistant',
                recipientId: 'user', // Ensure this is never undefined
                groupName: null, // Ensure DB fields are always defined
                message: assistantMessage || '', // Ensure not undefined
                timestamp: new Date().toISOString(),
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenAI API error:', error);
            throw error;
        }
    }

    async callClaude(messages) {
        if (!this.claudeApiKey) {
            throw new Error('Claude API key not configured');
        }

        try {
            // Convert to Claude API format
            const claudeMessages = messages.map(msg => ({
                role: msg.role === 'assistant' ? 'assistant' : 'user',
                content: msg.content
            }));

            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: this.claudeModel,
                    messages: claudeMessages,
                    max_tokens: 1000
                },
                {
                    headers: {
                        'x-api-key': this.claudeApiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.content[0].text;

            return {
                senderId: 'AI_Assistant',
                recipientId: 'user', // Ensure this is never undefined
                groupName: null, // Ensure DB fields are always defined
                message: assistantMessage || '', // Ensure not undefined
                timestamp: new Date().toISOString(),
                status: 'delivered'
            };
        } catch (error) {
            logger.error('Claude API error:', error);
            throw error;
        }
    }

    async callOpenRouter(messages) {
        if (!this.openRouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'openai/gpt-3.5-turbo',
                    messages: messages
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.openRouterApiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const assistantMessage = response.data.choices[0].message.content;

            return {
                senderId: 'AI_Assistant',
                recipientId: 'user', // Ensure this is never undefined
                groupName: null, // Ensure DB fields are always defined
                message: assistantMessage || '', // Ensure not undefined
                timestamp: new Date().toISOString(),
                status: 'delivered'
            };
        } catch (error) {
            logger.error('OpenRouter API error:', error);
            throw error;
        }
    }
    
}


// Create instance and initialize quality control
const llmModuleInstance = new LLMModule();

// Only set up the module if it's enabled
if (llmModuleInstance.isModuleEnabled()) {
    (async () => {
        llmModuleInstance.personasConfig = await llmModuleInstance.loadPersonas();
        llmModuleInstance.initQualityControl();
    })();
    
    // Set the global reference to avoid circular dependency issues
    global.llmModule = llmModuleInstance;
    console.log('✅ LLMModule enabled and initialized');
} else {
    // Set global reference to null to indicate module is disabled
    global.llmModule = null;
    console.log('❌ LLMModule disabled due to configuration issues');
}

module.exports = llmModuleInstance;