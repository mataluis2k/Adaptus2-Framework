const { OpenAIEmbeddings } = require('@langchain/openai');
const { OllamaEmbeddings } = require('@langchain/ollama');

const { createRetrievalChain } = require('langchain/chains/retrieval');
//const { OpenAIEmbeddings } = require('langchain/embeddings/openai');
const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { Document } = require('langchain/document');
const path = require('path');
const fs = require('fs');
const { getDbConnection } = require(path.join(__dirname, 'db'));
const llmModule = require('./llmModule');
const { json } = require('body-parser');
const { createStuffDocumentsChain } = require('langchain/chains/combine_documents');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const buildPersonaPrompt  = require('./buildPersonaPrompt');

const MODEL_TOKEN_LIMITS = {
  'gpt-3.5-turbo': 4096,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-4o': 128000,
  'llama3': 8192,
  'llama3.3': 32768,
  'mxbai-embed-large': 2048,
  'maryasov/qwen2.5-coder-cline': 8192,
  'llava': 4096,
  'deepseek-r1:70b': 32768,
  'qwen2.5-coder:32b': 32768
};

// Global variables to store the vector store and conversation history
let vectorStore;
// Store conversation histories for different users
const ragConversationHistories = new Map();
// Maximum number of exchanges to store per user
const MAX_HISTORY_LENGTH = 100;
// Collection name for ChromaDB
const COLLECTION_NAME = process.env.CHROMA_COLLECTION_NAME || 'vshred_meal_plans';

function setVectorStore(store) {
  vectorStore = store;
}

/**
 * Utility to load the initial configuration and prepare documents.
 * This function should be run when the server starts.
 */
async function initializeRAG(apiConfig) {
  const ragEnabledTables = apiConfig.filter((config) =>
    config.mlmodel?.includes("rag")
  );

  if (ragEnabledTables.length === 0) {
    console.log("No RAG-enabled tables found in the configuration.");
    return;
  }

  console.log("Initializing RAG-enabled tables...");
  
  try {
    // Determine which embedding provider to use based on environment config
    let embeddings;
    const embeddingProvider = process.env.EMBEDDING_PROVIDER || llmModule.llmType.toLowerCase();
    
    if (embeddingProvider === 'ollama') {
      // Use Ollama embeddings
      const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      // Use a model for embeddings - mxbai-embed-large is used in your examples
      const ollamaModel = process.env.OLLAMA_EMBEDDING_MODEL || 'mxbai-embed-large';
      
      try {
        console.log(`Using Ollama embeddings with model: ${ollamaModel}`);
        embeddings = new OllamaEmbeddings({
          baseUrl: ollamaBaseUrl,
          model: ollamaModel,
          dimensions: 1536 // Explicitly set dimensions to match collection
        });
      } catch (error) {
        console.error(`Failed to initialize Ollama embeddings with model ${ollamaModel}:`, error.message);
        console.warn(`Attempting to use a fallback embedding model...`);
        
        // Try with a fallback model
        try {
          const fallbackModel = 'llama2';
          console.log(`Trying fallback Ollama embedding model: ${fallbackModel}`);
          embeddings = new OllamaEmbeddings({
            baseUrl: ollamaBaseUrl,
            model: fallbackModel,
            dimensions: 1536 // Explicitly set dimensions to match collection
          });
        } catch (secondError) {
          console.error(`Failed to initialize fallback Ollama embeddings:`, secondError.message);
          throw new Error('Could not initialize any embedding model with Ollama');
        }
      }
    } else {
      // Default to OpenAI embeddings if available
      if (!process.env.OPENAI_API_KEY) {
        console.warn('No OpenAI API key found for embeddings. Trying to use Ollama instead.');
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        // Use a commonly available model from your examples
        const ollamaModel = process.env.OLLAMA_EMBEDDING_MODEL || 'mxbai-embed-large';
        
        try {
          console.log(`Falling back to Ollama embeddings with model: ${ollamaModel}`);
          embeddings = new OllamaEmbeddings({
            baseUrl: ollamaBaseUrl,
            model: ollamaModel,
            dimensions: 1536 // Explicitly set dimensions to match collection
          });
        } catch (error) {
          console.error(`Failed to initialize Ollama embeddings with fallback model ${ollamaModel}:`, error.message);
          
          // Try with another fallback model
          try {
            const secondFallbackModel = 'llama2';
            console.log(`Trying second fallback Ollama embedding model: ${secondFallbackModel}`);
            embeddings = new OllamaEmbeddings({
              baseUrl: ollamaBaseUrl,
              model: secondFallbackModel,
              dimensions: 1536 // Explicitly set dimensions to match collection
            });
          } catch (secondError) {
            console.error(`Could not initialize any embedding models. RAG functionality will be limited:`, secondError.message);
            throw new Error('Failed to initialize embeddings with any available provider');
          }
        }
      } else {
        console.log('Using OpenAI embeddings');
        try {
          embeddings = new OpenAIEmbeddings();
        } catch (error) {
          console.error('Failed to initialize OpenAI embeddings:', error.message);
          throw new Error('Failed to initialize OpenAI embeddings. Check your API key and connection.');
        }
      }
    }
    
    // ChromaDB connection settings
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    const chromaTenant = process.env.CHROMA_TENANT || 'default_tenant';
    const chromaDatabase = process.env.CHROMA_DATABASE || 'default_database';
    
    try {
      console.log(`Connecting to existing ChromaDB ========================================== collection: ${COLLECTION_NAME}`);
      // Try to connect to existing collection
      vectorStore = await Chroma.fromExistingCollection(embeddings, {
        collectionName: COLLECTION_NAME,
        url: chromaUrl,
        tenant: chromaTenant,
        database: chromaDatabase,
        dimensions: 1024
      });
      console.log("Successfully connected to existing ChromaDB collection");
      
      // Check if we need to update the collection
      const shouldUpdateCollection = process.env.ALWAYS_UPDATE_COLLECTION === 'true';
      
      if (shouldUpdateCollection) {
        console.log("ALWAYS_UPDATE_COLLECTION is set to true. Updating collection...");
        await populateChromaFromDatabase(ragEnabledTables, vectorStore);
      } else {
        console.log("Using existing ChromaDB collection without updates");
        console.log("Set ALWAYS_UPDATE_COLLECTION=true to force update on each startup");
      }
    } catch (error) {
      console.warn(`Could not connect to existing collection: ${error.message}`);
      console.log("Creating new collection and populating with documents...");
      
      // Create a new collection and populate it
      vectorStore = await Chroma.fromTexts(
        ["Initializing new collection"], // Need at least one document to initialize
        [{ source: "initialization" }],
        embeddings,
        {
          collectionName: COLLECTION_NAME,
          url: chromaUrl,
          tenant: chromaTenant,
          database: chromaDatabase,
        }
      );
      
      // Now populate the collection with documents from the database
      await populateChromaFromDatabase(ragEnabledTables, vectorStore);
    }
    
    console.log("RAG initialization completed successfully.");
  } catch (error) {
    console.error("Error initializing ChromaDB vector store:", error);
    vectorStore = null; // Ensure vectorStore is null if initialization fails
  }
}

/**
 * Populate ChromaDB with documents from database tables
 * @param {Array} tables - Config objects for RAG-enabled tables
 * @param {Object} vectorStore - ChromaDB vector store instance
 */
async function populateChromaFromDatabase(tables, vectorStore) {
  const BATCH_SIZE = 100; // Number of documents to process at once
  const crypto = require('crypto');
  
  for (const table of tables) {    
    console.log(`Processing table: ${table.dbType} - ${table.dbConnection}`);
    try {
      const connection = await getDbConnection(table);
      if (!connection) {
        console.error(`Database connection failed for ${table.dbConnection}`);
        continue;
      }
      
      // Check if we need to identify primary key for the table
      let primaryKeyColumn = 'id'; // Default assumption
      try {
        // Try to determine the primary key of the table
        const [pkResult] = await connection.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
          WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = ? 
            AND CONSTRAINT_NAME = 'PRIMARY'
        `, [table.dbTable]);
        
        if (pkResult && pkResult.length > 0) {
          primaryKeyColumn = pkResult[0].COLUMN_NAME;
          console.log(`Identified primary key for ${table.dbTable}: ${primaryKeyColumn}`);
        } else {
          console.log(`Could not identify primary key for ${table.dbTable}, using default 'id'`);
        }
      } catch (pkError) {
        console.warn(`Could not determine primary key for ${table.dbTable}: ${pkError.message}`);
        console.log(`Using fallback identifier strategy`);
      }

      // Get total count of rows
      const [countResult] = await connection.execute(`SELECT COUNT(*) as count FROM ${table.dbTable}`);
      const totalRows = countResult[0].count;
      console.log(`Found ${totalRows} rows in ${table.dbTable}`);
      
      // Process in batches to avoid memory issues
      const batches = Math.ceil(totalRows / BATCH_SIZE);
      
      for (let batch = 0; batch < batches; batch++) {
        const offset = batch * BATCH_SIZE;
        // Make sure to include the primary key in the query
        let columns = table.allowRead.slice(); // Copy array
        if (!columns.includes(primaryKeyColumn) && primaryKeyColumn !== 'id') {
          columns.push(primaryKeyColumn);
        }
        
        const query = `SELECT ${columns.join(", ")} FROM ${table.dbTable} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
        console.log(`Executing batch query ${batch+1}/${batches}: ${query}`);
        
        const [rows] = await connection.execute(query);
        
        // Generate documents with unique IDs based on content
        const batchDocuments = [];
        const idTracker = new Set(); // Track IDs to avoid duplicates within this batch
        
        for (const row of rows) {
          // Create a unique document ID that can be used to check for duplicates
          let documentId;
          
          if (row[primaryKeyColumn]) {
            // If we have a primary key, use that as part of the ID
            documentId = `${table.dbTable}-${primaryKeyColumn}-${row[primaryKeyColumn]}`;
          } else {
            // Otherwise, create a hash of the content
            const contentString = Object.entries(row)
              .map(([key, value]) => `${key}:${value}`)
              .join('|');
            const contentHash = crypto
              .createHash('md5')
              .update(contentString)
              .digest('hex');
            documentId = `${table.dbTable}-hash-${contentHash}`;
          }
          
          // Skip if we already have this document in the current batch
          if (idTracker.has(documentId)) {
            continue;
          }
          idTracker.add(documentId);
          
          // Create document content
          const pageContent = Object.entries(row)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");
          
          batchDocuments.push(
            new Document({
              pageContent,
              metadata: { 
                source: table.route, 
                table: table.dbTable,
                documentId: documentId,
                batchId: batch 
              },
            })
          );
        }
        
        // Check if these documents already exist in ChromaDB
        try {
          // Get list of document IDs we want to add
          const docIds = batchDocuments.map(doc => doc.metadata.documentId);
          
          // Check which IDs already exist in ChromaDB
          // We use a simple search to find matching document IDs
          // Note: This approach may not work with all vector stores
          // For better implementation, you could use the ChromaDB API directly
          
          // If no documents to process, skip this batch
          if (batchDocuments.length === 0) {
            console.log(`No documents to add in batch ${batch+1}/${batches}`);
            continue;
          }
          
          // We need to check for duplicates by adding with explicit IDs
          const documentsWithIds = batchDocuments.map(doc => ({
            id: doc.metadata.documentId,
            document: doc
          }));
          
          // Add documents to ChromaDB with their IDs to prevent duplicates
          await vectorStore.addDocuments(
            documentsWithIds.map(item => item.document),
            { ids: documentsWithIds.map(item => item.id) }
          );
          
          console.log(`Added batch ${batch+1}/${batches} (${batchDocuments.length} documents) to ChromaDB`);
        } catch (error) {
          console.error(`Error adding batch ${batch+1} to ChromaDB: ${error.message}`);
          // Try a more direct approach if the above fails
          try {
            // Add documents one by one
            let addedCount = 0;
            for (const doc of batchDocuments) {
              try {
                await vectorStore.addDocuments([doc], { ids: [doc.metadata.documentId] });
                addedCount++;
              } catch (innerError) {
                console.warn(`Could not add document ${doc.metadata.documentId}: ${innerError.message}`);
              }
            }
            console.log(`Added ${addedCount}/${batchDocuments.length} documents individually after batch failure`);
          } catch (fallbackError) {
            console.error(`Could not add documents even individually: ${fallbackError.message}`);
          }
        }
      }
    } catch (error) {
      console.error(
        `Error processing table "${table.dbTable}": ${error.message}`
      );
    }
  }
  
  console.log("Finished populating ChromaDB with documents from all tables");
}

/**
 * Get or initialize conversation history for a user
 * @param {string} userId - The user's ID
 * @returns {Array} - The user's conversation history
 */
function getUserHistory(userId) {
  if (!ragConversationHistories.has(userId)) {
    ragConversationHistories.set(userId, []);
  }
  return ragConversationHistories.get(userId);
}


function estimateTokenLength(text = '') {
  if (!text) return 0;

  const wordCount = text.trim().split(/\s+/).length;
  return Math.ceil(wordCount * 1.33); // Conservative estimate
}
async function searchAcrossCollections(query, collectionNames, topK = 5) {
  const results = [];
  for (const name of collectionNames) {
    const vs = await Chroma.fromExistingCollection(embeddings, {
      collectionName: name,
      url: chromaUrl,
      tenant: chromaTenant,
      database: chromaDatabase,
      dimensions: 1024
    });
    const res = await vs.similaritySearch(query, topK);
    results.push(...res);
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

async function sanitizeJsonInPrompt(prompt) {
  if (!prompt) return '';
  
  // Check if the prompt contains JSON-like structures
  const jsonRegex = /{[\s\S]*?}/g;
  
  if (jsonRegex.test(prompt)) {
    // There might be JSON in the prompt
    console.log('Detected potential JSON in prompt, performing advanced sanitization');
    
    try {
      // Strategy 1: Stringify and encode any JSON objects in the text
      // Find JSON-like patterns and replace them with encoded versions
      const sanitized = prompt.replace(jsonRegex, (match) => {
        try {
          // Try to parse it as JSON to validate
          const jsonObj = JSON.parse(match);
          // If successful, encode it to prevent template processing
          return `<JSON_DATA>${JSON.stringify(jsonObj).replace(/{/g, '{{').replace(/}/g, '}}')}</JSON_DATA>`;
        } catch (e) {
          // If it's not valid JSON, just escape the braces
          return match.replace(/{/g, '{{').replace(/}/g, '}}');
        }
      });
      
      return sanitized;
    } catch (error) {
      console.warn('Advanced JSON sanitization failed, falling back to basic escaping', error);
      // Fall back to basic escaping
      return prompt.replace(/{/g, '{{').replace(/}/g, '}}');
    }
  }
  
  // If no JSON detected, just do basic escaping
  return prompt.replace(/{/g, '{{').replace(/}/g, '}}');
}
/**
 * Recursively converts an object or JSON string into a human-readable paragraph.
 * @param {string|object} input - JSON string or parsed object.
 * @returns {string} A paragraph describing the JSON.
 */
function jsonToParagraph(input) {
  let obj;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      // Not valid JSON? Just return it verbatim.
      return input;
    }
  } else {
    obj = input;
  }

  function recurse(val) {
    if (val === null || typeof val !== 'object') {
      return String(val);
    }
    if (Array.isArray(val)) {
      return val.map(recurse).join(', ');
    }
    // Plain object
    return Object.entries(val)
      .map(([k, v]) => {
        // turn camelCase or snake_case into words
        const prettyKey = k
          .replace(/([A-Z])/g, ' $1')
          .replace(/[_\-]/g, ' ')
          .trim();
        return `${prettyKey}: ${recurse(v)}`;
      })
      .join('. ')
      + '.';
  }

  return recurse(obj);
}

/**
 * Scans a block of text for JSON snippets and replaces them
 * with their paragraph form.
 */
function sanitizeJsonBlocks(text) {
  return text.replace(/(\{[\s\S]*?\})/g, (match) => {
    // Only replace if it’s valid JSON
    try {
      JSON.parse(match);
      return jsonToParagraph(match);
    } catch {
      return match;
    }
  });
}

function stripAllDelimiters(text) {
  return text.replace(/["\{\}\[\]]/g, '');
}
async function handleRAG(query, userId = 'default', personaName = null, model = null) {
  if (!vectorStore) return handleNoVectorStoreQuery(query, userId, personaName);
  console.log(`[RAG Debug] handleRAG called with query: "${query.substring(0, 50)}..."`, 
  `userId: ${userId}, personaName: ${personaName}`);
  try {

    // Initialize persona handling
    let enhancedPersona = personaName;
    
    if (!enhancedPersona) {
      try {
       
          const personaList = await llmModule.getPersonasWithDescriptions();
          // Ensure we await the persona selection
          enhancedPersona = await llmModule.selectPersona(query, personaList);        
        
        // Add a check to ensure we have a valid persona string
        if (enhancedPersona && typeof enhancedPersona === 'object' && enhancedPersona.then) {
          enhancedPersona = await enhancedPersona; // Resolve if it's still a promise
        }
        
        console.log(`Selected personaRag: ${enhancedPersona}`);
      } catch (personaError) {
        console.error('Error selecting persona:', personaError);
        enhancedPersona = 'default'; // Fallback to default persona
      }
    }
    if(!model){
      model = process.env.OLLAMA_INFERENCE || 'llama3.3';
    }

    const llm = await llmModule.getLLMInstance(model);
    const fallbackModel = 'llama3.3';
    const rawModelName = process.env.OLLAMA_INFERENCE || fallbackModel;
    const modelName = MODEL_TOKEN_LIMITS[rawModelName] ? rawModelName : fallbackModel;
    const contextLimit = MODEL_TOKEN_LIMITS[modelName];

    // Ensure persona prompt is created with resolved persona value
    let personaPrompt = '';
    let personaConfig = null;
    if (enhancedPersona) {
      try {
        if (typeof enhancedPersona === 'string') {
          personaConfig = llmModule.personasConfig[enhancedPersona] || {};
        }else {
          personaConfig = enhancedPersona;
        }
        console.log(`Building persona prompt for: ${enhancedPersona} and userId: ${userId}`);
        personaPrompt = await buildPersonaPrompt(personaConfig,userId);        
      } catch (promptError) {
        console.error('Error building persona prompt:', promptError);
      }
    }
    console.log(`Using persona prompt: ${personaPrompt}`);
    const retriever = vectorStore.asRetriever({ searchKwargs: { k: 30 } });
    const topChunks = await retriever.getRelevantDocuments(query);

    if (!Array.isArray(topChunks)) {
      throw new Error("Expected topChunks to be an array, but got: " + typeof topChunks);
    }

    // Modified grouping logic to use source instead of document_id
    const grouped = topChunks.reduce((acc, chunk) => {
      // Use source from metadata, fallback to chunk source if available, otherwise unknown
      const sourceId = chunk.metadata?.source || chunk.source || 'unknown';
      if (!acc[sourceId]) {
        acc[sourceId] = {
          content: [],
          metadata: chunk.metadata || {}
        };
      }
      acc[sourceId].content.push(chunk.pageContent);
      return acc;
    }, {});

    // Convert grouped data to array format
    const topDocuments = Object.entries(grouped)
      .slice(0, 5)
      .map(([sourceId, data]) => ({
        id: sourceId,
        content: data.content.join('\n'),
        metadata: data.metadata
      }));

    let fullContext = topDocuments
      .map(doc => `Source: ${doc.id}\n${doc.content}`)
      .join('\n\n');

    const summarizeEnabled = process.env.USE_CONTEXT_SUMMARIZATION === 'true';

    if (summarizeEnabled || estimateTokenLength(fullContext) > contextLimit * 0.8) {
      console.log(`[RAG] Summarizing documents...`);
      const summaries = await Promise.all(
        topDocuments.map(async doc => {
          const res = await llm.call({
            messages: [
              { role: "system", content: "Summarize the document below in a paragraph:" },
              { role: "user", content: doc.content }
            ]
          });
          return typeof res === 'string' ? res : res.message || '';
        })
      );
      fullContext = summaries.join('\n\n');
    }
    // Sanitize the full context to prevent template injection
    personaPrompt = await sanitizeJsonBlocks(personaPrompt);
    personaPrompt = stripAllDelimiters(personaPrompt);
    
    console.log(`Sanitized persona prompt: ${personaPrompt}`);
    const combineDocsChain = await createStuffDocumentsChain({
      llm,
      prompt: ChatPromptTemplate.fromMessages([
        ["system", `${personaPrompt}\nUse the following information to answer the user's question.`],
        ["user", "Answer this question using the provided context: {input}\n\nContext: {context}"]
      ])
    });

    console.log(`Full context: ${fullContext}`);
    
    // Get user history before using it
    const history = getUserHistory(userId);
    
    // Create a Document object with the full context
    const documents = [new Document({ pageContent: fullContext })];
    
    // Invoke with proper Document objects
    const result = await combineDocsChain.invoke({
      input: query,
      documents: documents, // Pass array of Document objects instead of raw context
      chat_history: history.map(h => [h.query, h.response])
    });

    history.push({ query, response: result.answer, personaUsed: enhancedPersona || 'default' });
    if (history.length > MAX_HISTORY_LENGTH) {
      ragConversationHistories.set(userId, history.slice(-MAX_HISTORY_LENGTH));
    }

    console.log(JSON.stringify(result, null, 2));
    return {
      text: result,
      source_documents: topDocuments.map(doc => ({
        id: doc.id,
        metadata: doc.metadata
      })),
      personaUsed: enhancedPersona || 'default'
    };

  } catch (err) {
    console.error("RAG execution error:", err);
    throw err;
  }
}
/**
 * Clears the conversation history for a specific user
 * @param {string} userId - The user's ID whose history to clear
 */
function clearConversationHistory(userId = 'default') {
  if (userId === 'all') {
    ragConversationHistories.clear();
    console.log("All conversation histories cleared");
  } else {
    ragConversationHistories.set(userId, []);
    console.log(`Conversation history cleared for user ${userId}`);
  }
}

/**
 * Get stats about the RAG system
 * @returns {Object} - Statistics about the RAG system
 */
function getRagStats() {
  const userCount = ragConversationHistories.size;
  const totalExchanges = Array.from(ragConversationHistories.values())
    .reduce((sum, history) => sum + history.length, 0);
  
  // Determine which embedding provider is being used
  let embeddingProvider = "not initialized";
  let chromaDetails = {
    url: "not connected",
    collection: "none",
  };
  
  if (vectorStore) {
    // Try to identify the embedding provider from the vectorStore
    if (vectorStore.embeddings) {
      if (vectorStore.embeddings instanceof OpenAIEmbeddings) {
        embeddingProvider = "OpenAI";
      } else if (vectorStore.embeddings instanceof OllamaEmbeddings) {
        embeddingProvider = `Ollama (${vectorStore.embeddings.model || 'unknown model'})`;
      } else {
        embeddingProvider = "Unknown provider";
      }
    }
    
    // Get ChromaDB details
    if (vectorStore.client) {
      chromaDetails = {
        url: vectorStore.url || process.env.CHROMA_URL || "http://localhost:8000",
        collection: vectorStore.collectionName || COLLECTION_NAME,
        tenant: vectorStore.tenant || process.env.CHROMA_TENANT || "default_tenant",
        database: vectorStore.database || process.env.CHROMA_DATABASE || "default_database"
      };
    }
    
    // Try to get document count if possible
    try {
      // This would need to be implemented using the actual ChromaDB client API
      // as LangChain may not expose this functionality directly
      chromaDetails.documentCount = "Unknown (not directly accessible through LangChain)";
      
      // For a more accurate count, you would need to use the ChromaDB client directly:
      // const count = await vectorStore.client.count({
      //   collectionName: COLLECTION_NAME
      // });
      // chromaDetails.documentCount = count;
    } catch (error) {
      console.warn(`Could not get document count: ${error.message}`);
    }
  }
  
  return {
    isInitialized: !!vectorStore,
    embeddingProvider,
    vectorDb: "ChromaDB",
    chromaDetails,
    llmProvider: llmModule.llmType,
    userCount,
    totalExchanges,
    maxHistoryPerUser: MAX_HISTORY_LENGTH
  };
}

/**
 * Fallback handler for when no vector store is available
 * @param {string} query - The user's query
 * @param {string} userId - The user's ID
 * @returns {Object} - The response from the LLM
 */
async function handleNoVectorStoreQuery(query, userId = 'default') {
  console.warn("Vector store not initialized. Running in fallback mode without RAG.");
  
  try {
    // Get user's conversation history
    const userHistory = getUserHistory(userId);
    
    // Format the conversation history
    const formattedHistory = userHistory.map(exchange => 
      `Human: ${exchange.query}\nAI: ${exchange.response}`
    ).join('\n');
    
    // Create a prompt that notes the lack of RAG context
    const prompt = `
    You are an AI assistant. The database search function is currently not available, 
    so you'll need to answer based on your general knowledge.
    
    CONVERSATION HISTORY:
    ${formattedHistory}
    
    USER QUERY: ${query}
    
    Provide a helpful response based on your general knowledge. If you don't know the answer, 
    say so clearly and suggest that the user try again when the database search function is available.
    `;
    
    // Prepare message data for llmModule
    const messageData = {
      senderId: userId,
      recipientId: 'AI_Assistant',
      message: prompt,
      groupName: null,
      timestamp: new Date().toISOString(),
      status: 'processing'
    };
    
    // Call the LLM
    const response = await llmModule.simpleLLMCall(messageData);
    
    if (!response || !response.message) {
      throw new Error('No response received from LLM');
    }
    
    // Extract the LLM's response
    const llmResponse = response.message;
    
    // Add to history
    userHistory.push({
      query: query,
      response: llmResponse
    });
    
    // Limit history
    if (userHistory.length > MAX_HISTORY_LENGTH) {
      ragConversationHistories.set(userId, userHistory.slice(-MAX_HISTORY_LENGTH));
    }
    
    return {
      text: llmResponse,
      source_documents: [],
      fallback: true
    };
  } catch (error) {
    console.error("Fallback query handler error:", error.message);
    throw error;
  }
}

/**
 * Add new documents to the vector store
 * @param {Array} documents - Array of Document objects
 * @returns {boolean} - Success status
 */
async function addDocumentsToRAG(documents) {
  if (!vectorStore) {
    console.error("Vector store not initialized. Cannot add documents.");
    return false;
  }
  
  try {
    console.log(`Adding ${documents.length} new documents to ChromaDB collection ${COLLECTION_NAME}`);
    await vectorStore.addDocuments(documents);
    console.log("Documents added successfully");
    return true;
  } catch (error) {
    console.error("Error adding documents to ChromaDB:", error.message);
    return false;
  }
}

function getVectorStore() {
  if (!vectorStore) {
    throw new Error('Chroma vector store has not been initialized yet. Make sure initializeRAG() ran on startup.');
  }
  return vectorStore;
}

module.exports = {
  getVectorStore,
  initializeRAG,
  handleRAG,
  clearConversationHistory,
  getRagStats,
  handleNoVectorStoreQuery,
  addDocumentsToRAG
};