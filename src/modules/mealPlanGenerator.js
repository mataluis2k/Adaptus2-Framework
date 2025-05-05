const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { OllamaEmbeddings } = require('@langchain/ollama');
const ragHandler = require('./ragHandler1');
const llm = require('./llmModule');

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

const MealPlanGenerator = {
    "description": "Generate a 7-day meal plan that meets the following requirements strictly outputting valid JSON",
    "behaviorInstructions": "You are a knowledgeable and approachable nutritional advisor focused on providing balanced, sustainable 7-day meal plans that meet specific macro and dietary requirements. Communicate clearly and encouragingly, guiding users through healthy eating choices.",
    "functionalDirectives": "Generate a meal plan strictly as valid JSON. Each day must include breakfast, lunch, dinner, and two snacks, with nutritional breakdowns (calories, protein, fat, carbs). Honor user dietary preferences, restrictions, and goals. Use the provided example meal plans as guidance.",    
    "knowledgeConstraints": "Specialize in nutrition, meal planning, and healthy eating habits. Avoid medical diagnoses or advice outside basic nutrition principles. Assume users understand fundamental nutrition terminology.",
    "ethicalGuidelines": "Ensure all recommendations are safe, evidence-based, and appropriate for general healthy adults. Prioritize user well-being, respect privacy, and avoid personal data exposure.",
    "collection": [
      "vshred_meal_plans"
    ]
}
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
  
    // Build a clear, spaced-out query
    const query = `Meal plan with likes: ${macroRequest.mylikes.join(', ')} ` +
                  `and restrictions: ${macroRequest.dietary_restrictions.join(', ')}`;
  
    try {
      const mealPlan = [];
  
      // for (let day = 0; day < 7; day++) {
       
      // }
       // Call your existing RAG handler
       const result = await ragHandler.handleRAG(query, 2, MealPlanGenerator);
  
       // Add to array
       if (result.text) {
           mealPlan.push(result.text);
       }
      // Remove duplicates (see next section)
      //const uniqueMealPlan = removeDuplicates(mealPlan);
  
      console.log(JSON.stringify(mealPlan));
      res.json({ plan: mealPlan });
      console.log('Meal plan generated successfully:', mealPlan);
  
    } catch (err) {
      console.error('Error generating meal plan:', err);
      res.status(500).json({ error: err.message });
    }
  }
  
  // Simple helper to filter out duplicate plans by JSON content
  function removeDuplicates(plans) {
    const seen = new Set();
    return plans.filter(plan => {
      const key = JSON.stringify(plan);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  

/**
 * Endpoint handler: uses RAG + persona prompt to generate meal plans.
 */
async function generateMealPlan2(req, res) {
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
      //const { meal_plan, source_documents } = await ragHandler.handleRAG(prompt, 2, 'The_Nutritional_Wellness_Advisor');
      const meal_plan = await llm.callLLM(prompt);
      console.log(JSON.stringify(meal_plan));
      const response = { plan : meal_plan };
  
      res.json(response);
      console.log('Meal plan generated successfully:', response);
    } catch (err) {
      console.error('Error generating meal plan:', err);
      res.status(500).json({ error: err.message });
    }
  }
  
module.exports = {
  generateMealPlan
};
