const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { OllamaEmbeddings } = require('@langchain/ollama');
const ragHandler = require('./ragHandler1');
const { cos } = require('@tensorflow/tfjs-node');

// Configuration via environment
const {
  CHROMA_URL,
  CHROMA_PORT,
  CHROMA_TENANT,
  CHROMA_DATABASE,
  CHROMA_COLLECTION_NAME = 'vshred_meal_plans',
  OLLAMA_BASE_URL,
  OLLAMA_EMBEDDING_MODEL
} = process.env;

/**
 * Build a detailed prompt for the Nutrition Advisor persona.
 */
function buildPromptForMacros(macroRequest, similarDocs) {
  const { target_calories, protein_percentage, fat_percentage, carbs_percentage, fiber_percentage = 0, dietary_restrictions = [] } = macroRequest;

  // Gather example texts from similar docs
  const examples = similarDocs.length > 0
    ? similarDocs.slice(0,2).map((d,i) => `Example ${i+1}: ${d.content}`).join("\n\n")
    : 'No example meal plans available.';

  return `You are a Nutrition Advisor with expertise in meal planning.\n\n` +
         `Task:\nGenerate a 7-day meal plan that meets the following requirements strictly outputting valid JSON:\n` +
         `- Target calories: ${target_calories}\n` +
         `- Protein percentage: ${protein_percentage}%\n` +
         `- Fat percentage: ${fat_percentage}%\n` +
         `- Carbs percentage: ${carbs_percentage}%\n` +
         `- Fiber percentage: ${fiber_percentage}%\n` +
         `- Dietary restrictions: ${dietary_restrictions.join(', ') || 'none'}\n\n` +
         `Use these example meal plans as guidance:\n${examples}\n\n` +
         `JSON Schema:\n` +
         `{
  "plan_id": "string",
  "target_macros": {
    "calories": number,
    "protein": { "percentage": number, "grams": number },
    "fat": { "percentage": number, "grams": number },
    "carbs": { "percentage": number, "grams": number }
  },
  "days": [
    { "day": "Monday", "meals": [ { "name": string, "calories": number, "protein": number, "fat": number, "carbs": number, "fiber": number, "ingredients": [string], "instructions": string } ] }
    // ... repeat for all 7 days
  ]
}`;
}

/**
 * Endpoint handler: uses RAG + persona prompt to generate meal plans.
 */
async function generateMealPlan(req, res) {
  const macroRequest = req.body;
  try {
    // Initialize vector store
    const vectorStore = ragHandler.getVectorStore();

    // Retrieve similar meal plan documents via RAG
    const queryText = `Meal plan with ${macroRequest.target_calories} calories, ${macroRequest.protein_percentage}% protein, ${macroRequest.fat_percentage}% fat, ${macroRequest.carbs_percentage}% carbs` +
                      (macroRequest.dietary_restrictions?.length ? ` with restrictions: ${macroRequest.dietary_restrictions.join(',')}` : '');
    const retriever = vectorStore.asRetriever({ searchKwargs: { k: 30 } });
    const topChunks = await retriever.getRelevantDocuments(queryText);
    if (!Array.isArray(topChunks)) {
            throw new Error(`Expected topChunks to be an array, but got: ${typeof topChunks}`);
    }
    console.log(`Top chunks retrieved: ${topChunks.length}`);
    // Group by source
    const grouped = topChunks.reduce((acc, chunk) => {
                const sourceId = chunk.metadata?.source || chunk.source || 'unknown';
                if (!acc[sourceId]) {
                    acc[sourceId] = { content: [], 
                                    metadata: chunk.metadata || {} 
                                    };
                }
                acc[sourceId].content.push(chunk.pageContent);
                return acc;
                }, {}
    );
    console.log(`Grouped documents by source: ${Object.keys(grouped).length} sources found`);
    // Build topDocuments array
    const topDocuments = Object.entries(grouped)
    .slice(0, 5)
    .map(([sourceId, data]) => ({ id: sourceId, content: data.content.join('\n'), metadata: data.metadata }));
    console.log(`Top documents: ${topDocuments.length} documents found`);
    // Concatenate full context
    const similarDocs = topDocuments;
    console.log(`Concatenated similar documents: ${similarDocs.length} characters`);
    // Build persona-enhanced prompt
    const prompt = buildPromptForMacros(macroRequest, similarDocs);

    // Use existing handleRAG to get answer and source docs
    const { meal_plan, source_documents } = await ragHandler.handleRAG(prompt, 2, 'The_Nutritional_Wellness_Advisor');

    res.json({ meal_plan, source_documents });
  } catch (err) {
    console.error('Error generating meal plan:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  generateMealPlan
};
