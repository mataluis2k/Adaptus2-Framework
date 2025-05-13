const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { OllamaEmbeddings } = require('@langchain/ollama');

(async () => {
  const embeddings = new OllamaEmbeddings({
    model: 'mxbai-embed-large',
    baseUrl: 'http://34.232.44.133:11434', // Ollama server
  });

  const vectorStore = await Chroma.fromExistingCollection(embeddings, {
    collectionName: 'recipiesBook',
    url: 'http://34.232.44.133:8000', // ChromaDB server
    tenant: 'default_tenant',
    database: 'default_database',
  });

  const results = await vectorStore.similaritySearch("chicken recipe", 3);
  console.log("🔍 Top 3 results:");
  results.forEach((doc, i) => {
    console.log(`\n#${i + 1}:`);
    console.log(doc.pageContent);
  });
})();
