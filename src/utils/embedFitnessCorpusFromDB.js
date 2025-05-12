// embedFitnessCorpusFromDB.js (using MemoryVectorStore)
const mysql = require('mysql2/promise');
const { OpenAIEmbeddings } = require('langchain/embeddings/openai');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
require('dotenv').config();

const TARGET_TABLES = [
  'diet_plans',
  'exercises',
  'exercises_v2',
  'exercise_libraries_v2',
  'training_plans',
  'training_plans_v2',
  'user_workouts',
  'user_workout_v2',
  'workouts',
  'workouts_v2'
];

const POOL = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

let vectorStore;

async function embedTable(tableName) {
  const [rows] = await POOL.query(`SELECT * FROM \\`${tableName}\\``);
  const docs = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const values = Object.values(row).filter(v => typeof v === 'string' && v.length > 30);

    for (let j = 0; j < values.length; j++) {
      const content = values[j];
      docs.push({
        pageContent: content,
        metadata: {
          source_table: tableName,
          row_id: row.id || i,
          column_index: j
        }
      });
    }
  }

  if (docs.length > 0) {
    await vectorStore.addDocuments(docs);
    console.log(`✅ Embedded ${docs.length} chunks from ${tableName}`);
  }
}

async function embedAll() {
  const embeddings = new OpenAIEmbeddings();
  vectorStore = await MemoryVectorStore.fromTexts([], [], embeddings);

  for (const table of TARGET_TABLES) {
    console.log(`\n📦 Embedding content from table: ${table}`);
    await embedTable(table);
  }

  await POOL.end();
  console.log('\n✅ All tables embedded into in-memory vector store.');

  // Optional: expose globally for querying
  global.fitnessMemoryStore = vectorStore;
}

embedAll().catch(err => {
  console.error('❌ Failed to embed corpus:', err);
});
