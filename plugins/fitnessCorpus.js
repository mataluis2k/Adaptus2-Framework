const path = require('path');
const { Chroma } = require('langchain/vectorstores/chroma');
const { OllamaEmbeddings } = require('langchain/embeddings/ollama');
const { Document } = require('langchain/document');

const BATCH_SIZE = 500;

module.exports = {
    name: 'embedCorpusChroma',
    version: '1.0.0',

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the Adaptus2 server.
     */
    initialize(dependencies) {
        const { context, customRequire, process } = dependencies;
        const dbModule = customRequire('../src/modules/db');
        const { query } = dbModule;

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for embedCorpusChroma.');
        }

        /**
         * Embeds data from DB tables into a Chroma vector store.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - { dbType, dbConnection, tables, collectionName, path }
         */
        async function embedCorpus(ctx, params) {
            if (!params || typeof params !== 'object') {
                throw new Error('Invalid parameters. Ensure params is a valid object.');
            }

            const {
                dbType,
                dbConnection,
                tables = [],
                collectionName = 'default_corpus',
                path: chromaPath,
            } = params;

            if (!dbType || !dbConnection || tables.length === 0) {
                throw new Error('Missing required params: dbType, dbConnection, or tables.');
            }

            const fullPath = chromaPath || path.join(__dirname, `chroma_${collectionName}`);
            const embeddings = new OllamaEmbeddings({ model: 'mxbai-embed-large' });
            const vectorStore = await Chroma.fromTexts([], [], embeddings, {
                collectionName,
                url: 'http://localhost:8000',
                path: fullPath,
            });

            for (const table of tables) {
                try {
                    const countQuery = `SELECT COUNT(*) as count FROM \`${table}\``;
                    const countResult = await query({ dbType, dbConnection }, countQuery);
                    const total = countResult[0].count;
                    console.log(`📊 ${table} has ${total} records.`);

                    const pages = Math.ceil(total / BATCH_SIZE);
                    for (let page = 0; page < pages; page++) {
                        const offset = page * BATCH_SIZE;
                        const dataQuery = `SELECT * FROM \`${table}\` LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
                        const rows = await query({ dbType, dbConnection }, dataQuery);

                        const docs = rows.map((row, i) =>
                            new Document({
                                pageContent: Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('\n'),
                                metadata: { table, index: offset + i },
                            })
                        );

                        await vectorStore.addDocuments(docs);
                        console.log(`📥 Embedded ${docs.length} records from ${table} (batch ${page + 1}/${pages})`);
                    }
                } catch (err) {
                    console.error(`❌ Error processing table ${table}:`, err.message);
                }
            }

            console.log(`🚀 Embedding complete for collection: ${collectionName}`);
            return { success: true, collection: collectionName };
        }

        // Register action
        if (!context.actions.embedCorpus) {
            context.actions.embedCorpus = embedCorpus;
        }

        console.log('embedCorpusChroma action registered in global context.');
    },
};
