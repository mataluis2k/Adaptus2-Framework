#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');
const { Command } = require('commander');

const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { OllamaEmbeddings } = require('@langchain/ollama');
const { Document } = require('@langchain/core/documents');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');

const BATCH_SIZE = 500;

class EmbedCorpusCLI {
  constructor(config = {}) {
    this.COLLECTION_NAME = config.collection || 'default_corpus';
    this.SOURCE = config.source || 'mysql'; // mysql or csv
    this.TABLES = config.tables || [];
    this.CSV_FILE = config.file || null;
    this.VECTOR_STORE_PATH = config.path || path.join(__dirname, `chroma_${this.COLLECTION_NAME}`);
    this.batchSize = 25;

    if (this.SOURCE === 'mysql') {
      this.db = mysql.createPool({
        host: process.env.MYSQL_1_HOST,
        user: process.env.MYSQL_1_USER,
        password: process.env.MYSQL_1_PASSWORD,
        database: process.env.MYSQL_1_DB,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
    }
  }

  async run() {
    const embeddings = new OllamaEmbeddings({ model: 'mxbai-embed-large' });
    const vectorStore = await Chroma.fromTexts([], [], embeddings, {
      collectionName: this.COLLECTION_NAME,
      url: 'http://localhost:8000',
      tenant: 'default_tenant',
      database: 'default_database', 
    });

    if (this.SOURCE === 'mysql') {
      await this.embedFromMySQL(vectorStore);
    } else if (this.SOURCE === 'csv') {
      await this.embedFromCSV(vectorStore);
    } else {
      console.error(`Unsupported source: ${this.SOURCE}`);
      process.exit(1);
    }

    console.log(`🚀 Embedding complete for collection: ${this.COLLECTION_NAME}`);
  }

  async embedFromMySQL(vectorStore) {
    for (const table of this.TABLES) {
      try {
        const [countResult] = await this.db.query(`SELECT COUNT(*) as count FROM \`${table}\``);
        const total = countResult[0].count;
        console.log(`📊 ${table} has ${total} records.`);

        const pages = Math.ceil(total / BATCH_SIZE);
        for (let page = 0; page < pages; page++) {
          const offset = page * BATCH_SIZE;
          const [rows] = await this.db.query(`SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`);

          const docs = rows.map((row, i) =>
            new Document({
              pageContent: Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n'),
              metadata: { table, index: offset + i }
            })
          );

          await this.embedInBatches(vectorStore, allDocs, this.batchSize);
          console.log(`📥 Embedded ${docs.length} records from ${table} (batch ${page + 1}/${pages})`);
        }
      } catch (err) {
        console.error(`❌ Error processing table ${table}:`, err.message);
      }
    }
  }


  async embedFromCSV(vectorStore) {
    if (!this.CSV_FILE || !fs.existsSync(this.CSV_FILE)) {
      throw new Error(`CSV file not found: ${this.CSV_FILE}`);
    }
  
    return new Promise((resolve, reject) => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,      // Max characters per chunk
        chunkOverlap: 200     // Allow small overlap
      });
  
      const allDocs = [];
      let rowIndex = 0;
  
      fs.createReadStream(this.CSV_FILE)
        .pipe(csv())
        .on('data', (row) => {
          const rawText = Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n');
  
          splitter.createDocuments([rawText], [{ row: rowIndex }]).then((chunks) => {
            allDocs.push(...chunks);
          });
  
          rowIndex++;
        })
        .on('end', async () => {
          console.log(`📥 Prepared ${allDocs.length} chunks from ${rowIndex} rows`);
  
          try {
            await this.embedInBatches(vectorStore, allDocs, this.batchSize);
            resolve();
          } catch (err) {
            reject(err);
          }
        })
        .on('error', reject);
    });
  }

  /**
 * Embed documents in batches to avoid overloading vector store.
 * @param {Object} vectorStore - Initialized vector store (e.g., Chroma).
 * @param {Document[]} documents - Array of LangChain Documents.
 * @param {number} batchSize - Number of documents per batch.
 */
  async embedInBatches(vectorStore, documents, batchSize = 100) {
    const total = documents.length;
    const totalBatches = Math.ceil(total / batchSize);

    console.log(`🚀 Starting embedding in ${totalBatches} batches...`);

    for (let i = 0; i < total; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      try {
        await vectorStore.addDocuments(batch);
        console.log(`✅ Embedded batch ${batchNum}/${totalBatches} (${batch.length} docs)`);
      } catch (err) {
        console.error(`❌ Failed to embed batch ${batchNum}: ${err.message}`);
      }
    }

    console.log('🎉 Finished embedding all batches.');
  }

  
}

// CLI Definition
const program = new Command();
program
  .name('embed-corpus')
  .description('Embed content into ChromaDB using Ollama embeddings')
  .option('-s, --source <source>', 'Data source: mysql or csv', 'mysql')
  .option('-t, --tables <tables>', 'Comma-separated MySQL tables (for mysql source only)')
  .option('-f, --file <csvFile>', 'CSV file to embed (for csv source only)')
  .option('-c, --collection <name>', 'ChromaDB collection name', 'default_corpus')
  .option('-p, --path <chromaPath>', 'Path to Chroma vector store directory');

program.parse(process.argv);
const options = program.opts();

(async () => {
  const embedder = new EmbedCorpusCLI({
    source: options.source,
    collection: options.collection,
    path: options.path,
    tables: options.tables ? options.tables.split(',').map(t => t.trim()) : [],
    file: options.file
  });
  await embedder.run();
})();
