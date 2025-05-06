const { OpenAIEmbeddings } = require('@langchain/openai');
const { OllamaEmbeddings } = require('@langchain/ollama');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { Document } = require('langchain/document');
const path = require('path');
const fs = require('fs');
const { getDbConnection } = require(path.join(__dirname, 'db'));
const llmModule = require('./llmModule');

// Global variables to store the vector store and conversation history
let vectorStore;
// Store conversation histories for different users
const ragConversationHistories = new Map();
// Maximum number of exchanges to store per user
const MAX_HISTORY_LENGTH = 100;

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
  const allDocuments = [];
  
  for (const table of ragEnabledTables) {    
    console.log(`Processing table: ${table.dbType} - ${table.dbConnection}`);
    try {
      const connection = await getDbConnection(table);
      if (!connection) {
        console.error(`Database connection failed for ${table.dbConnection}`);
        continue;
      }

      const query = `SELECT ${table.allowRead.join(", ")} FROM ${table.dbTable}`; 
      console.log(`Executing query: ${query}`);
      const [rows] = await connection.execute(query);

      console.log(`Processing ${rows.length} rows...`);
      const tableDocuments = rows.map((row) =>
        new Document({
          pageContent: Object.entries(row)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
          metadata: { source: table.route, table: table.dbTable },
          context: { table: table.dbTable },
        })
      );

      allDocuments.push(...tableDocuments);
     
    } catch (error) {
      console.error(
        `Error processing table "${table.dbTable}": ${error.message}`
      );
    }
  }

  if (allDocuments.length === 0) {
    console.warn("No documents were loaded for RAG. Vector store initialization skipped.");
    return;
  }

  try {
    console.log(`Creating vector store with ${allDocuments.length} documents...`);
    
    // Determine which embedding provider to use based on environment config
    let embeddings;
    const embeddingProvider = process.env.EMBEDDING_PROVIDER || llmModule.llmType.toLowerCase();
    
    if (embeddingProvider === 'ollama') {
      // Use Ollama embeddings
      const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      // Use a commonly available Ollama model that can provide embeddings
      // llama2 and mistral are commonly available in most Ollama installations
      const ollamaModel = process.env.OLLAMA_EMBEDDING_MODEL || 'llama2';
      
      try {
        console.log(`Using Ollama embeddings with model: ${ollamaModel}`);
        embeddings = new OllamaEmbeddings({
          baseUrl: ollamaBaseUrl,
          model: ollamaModel,
          // The OllamaEmbeddings constructor in langchain accepts dimensions
          // for models that support configurable embedding size
          dimensions: parseInt(process.env.OLLAMA_EMBEDDING_DIMENSIONS) || 384
        });
      } catch (error) {
        console.error(`Failed to initialize Ollama embeddings with model ${ollamaModel}:`, error.message);
        console.warn(`Attempting to use a fallback embedding model...`);
        
        // Try with a fallback model
        try {
          const fallbackModel = 'mistral';
          console.log(`Trying fallback Ollama embedding model: ${fallbackModel}`);
          embeddings = new OllamaEmbeddings({
            baseUrl: ollamaBaseUrl,
            model: fallbackModel
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
        // Use a commonly available model 
        const ollamaModel = process.env.OLLAMA_EMBEDDING_MODEL || 'llama2';
        
        try {
          console.log(`Falling back to Ollama embeddings with model: ${ollamaModel}`);
          embeddings = new OllamaEmbeddings({
            baseUrl: ollamaBaseUrl,
            model: ollamaModel
          });
        } catch (error) {
          console.error(`Failed to initialize Ollama embeddings with fallback model ${ollamaModel}:`, error.message);
          
          // Try with another fallback model
          try {
            const secondFallbackModel = 'mistral';
            console.log(`Trying second fallback Ollama embedding model: ${secondFallbackModel}`);
            embeddings = new OllamaEmbeddings({
              baseUrl: ollamaBaseUrl,
              model: secondFallbackModel
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
    
    // Create vector store with selected embedding provider
    vectorStore = await MemoryVectorStore.fromDocuments(
      allDocuments,
      embeddings
    );
    console.log("RAG initialization completed successfully.");
  } catch (error) {
    console.error("Error creating vector store:", error);
  }
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

/**
 * Handles RAG queries with conversation memory
 * @param {string} query - The user's query
 * @param {string} userId - The user's ID for maintaining conversation state
 * @returns {Object} - The response from the LLM
 */
async function handleRAG(query, userId = 'default') {
  if (!vectorStore) {
    console.warn("RAG is not initialized. Falling back to non-RAG query handling.");
    return handleNoVectorStoreQuery(query, userId);
  }
  
  try {
    // Retrieve relevant documents based on the query
    const relevantDocs = await vectorStore.similaritySearch(query, 5);
    
    // Format the retrieved documents into text
    const docText = relevantDocs.map(doc => doc.pageContent).join('\n\n');
    
    // Get user's conversation history
    const userHistory = getUserHistory(userId);
    
    // Format the conversation history
    const formattedHistory = userHistory.map(exchange => 
      `Human: ${exchange.query}\nAI: ${exchange.response}`
    ).join('\n');
    
    console.log(`Using conversation history with ${userHistory.length} previous exchanges for user ${userId}`);
    console.log(docText);
    const enhancedPrompt = `
    You are an AI assistant with both document-based knowledge and broader, general knowledge capabilities. When given a user query, follow these steps:
    
    1. **Search the CONTEXT INFORMATION**  
       - Carefully scan the “CONTEXT INFORMATION” section for any direct answer.  
       - If you find relevant details, answer concisely using that context.  
    
    2. **Fallback to General Knowledge**  
       - If the context does **not** contain an answer, switch to your broader knowledge base.  
       - Provide a helpful, accurate answer even if it’s unrelated to the context documents.  
       - Be transparent: briefly note that the answer comes from your general knowledge.
    
    ---
    
    CONTEXT INFORMATION:  
    \`\`\`  
    ${docText}  
    \`\`\`
    
    CONVERSATION HISTORY:  
    \`\`\`  
    ${formattedHistory}  
    \`\`\`
    
    USER QUERY:  
    \`\`\`  
    ${query}  
    \`\`\`
    
    Your response should:
    - First attempt to answer from the “CONTEXT INFORMATION.”  
    - If no answer is found, provide a well-reasoned answer from general knowledge.  
    - Be clear, concise, and user-focused.
    `;
    
    
    // Prepare message data for llmModule
    const messageData = {
      senderId: userId,
      recipientId: 'AI_Assistant',
      message: enhancedPrompt,
      groupName: null,
      timestamp: new Date().toISOString(),
      status: 'processing'
    };
    
    // Call the LLM with the enhanced prompt using llmModule
    const response = await llmModule.simpleLLMCall(messageData);
    
    if (!response || !response.message) {
      throw new Error('No response received from LLM');
    }
    
    // Extract the model's response
    const llmResponse = response.message;
    
    // Add the current exchange to the history
    userHistory.push({
      query: query,
      response: llmResponse
    });
    
    // Limit history to the last MAX_HISTORY_LENGTH exchanges
    if (userHistory.length > MAX_HISTORY_LENGTH) {
      ragConversationHistories.set(userId, userHistory.slice(-MAX_HISTORY_LENGTH));
    }
    
    console.log(`Conversation history for user ${userId} now has ${getUserHistory(userId).length} exchanges`);
    
    return {
      text: llmResponse,
      source_documents: relevantDocs
    };
  } catch (error) {
    console.error("RAG Module Error:", error.message);
    throw error;
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
  }
  
  return {
    isInitialized: !!vectorStore,
    embeddingProvider,
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

module.exports = {
  initializeRAG,
  handleRAG,
  clearConversationHistory,
  getRagStats,
  handleNoVectorStoreQuery
};