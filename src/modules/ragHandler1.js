const { OpenAIEmbeddings } = require('@langchain/openai');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { OpenAI } = require('@langchain/openai');
const { RetrievalQAChain } = require('langchain/chains');

const { Document } = require('langchain/document');


// Remaining code remains the same

// This module needs to be re-write to work better for server2.js 
// Few issues, if the tables have a lot of data then it will take a lot of time to load the data and provide a response for the user.
// Hence the loadConfig should happen when the server starts and not when the user makes a request.
// The Rag Module should only be called when the user makes a request and not when the server starts.

const fs = require("fs");
const path = require("path");
const { getDbConnection } = require(path.join(__dirname,'db'));
// Global variables to store the vector store and conversation history
let vectorStore;
// Store the last 5 conversation exchanges
let conversationHistory = [];
// Maximum number of exchanges to store (each exchange is a query-response pair)
const MAX_HISTORY_LENGTH = 100;

/**
 * Utility to load the initial configuration and prepare documents.
 * This function is run when the server starts.
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
          return res.status(500).json({ error: `Database connection failed for ${endpoint.dbConnection}` });
        }

      const query = `SELECT ${table.allowRead.join(", ")} FROM ${
        table.dbTable
      } `; // Adjust limit based on requirements
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

  console.log("Creating vector store...");
  vectorStore = await MemoryVectorStore.fromDocuments(
    allDocuments,
    new OpenAIEmbeddings()
  );

  console.log("RAG initialization completed.");
}


/**
 * Handles RAG queries with conversation memory
 * @param {string} query - The user's query
 * @returns {Object} - The response from the LLM
 */
async function handleRAG(query) {
    const openAIApiKey = process.env.OPENAI_API_KEY;
    const modelName = process.env.OPENAI_MODEL || "gpt-3.5-turbo-instruct";
    const temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7;

    if (!openAIApiKey) {
      throw new Error("OpenAI API Key not found. Please set OPENAI_API_KEY environment variable.");
    }
    if (!vectorStore) {
      throw new Error("RAG is not initialized. Please ensure `initializeRAG` is called at server startup.");
    }
  
    try {
      // Initialize the OpenAI model
      const model = new OpenAI({
        openAIApiKey: openAIApiKey,
        temperature: temperature,
        modelName: modelName,
      });
    
      const chain = RetrievalQAChain.fromLLM(
        model,
        vectorStore.asRetriever(),
        {
            returnSourceDocuments: false,
        }
      );
      
      // Format the conversation history for the LLM
      const formattedHistory = conversationHistory.map(exchange => 
        `Human: ${exchange.query}\nAI: ${exchange.response}`
      ).join('\n');
      
      console.log(`Using conversation history with ${conversationHistory.length} previous exchanges`);
      
      // Pass the conversation history to the chain
      const response = await chain.invoke({
        query: query, 
        chat_history: formattedHistory
      });
      
      // Add the current exchange to the history
      conversationHistory.push({
        query: query,
        response: response.text
      });
      
      // Limit history to the last MAX_HISTORY_LENGTH exchanges
      if (conversationHistory.length > MAX_HISTORY_LENGTH) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
      }
      
      console.log("Response:", response);
      console.log(`Conversation history now has ${conversationHistory.length} exchanges`);
  
      return response;
    } catch (error) {
      console.error("RAG Module Error:", error.message);
      throw error;
    }
  }


/**
 * Clears the conversation history
 */
function clearConversationHistory() {
  conversationHistory = [];
  console.log("Conversation history cleared");
}

module.exports = {
    initializeRAG,
    handleRAG,
    clearConversationHistory
  };
