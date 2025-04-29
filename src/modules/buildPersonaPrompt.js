const customerSupportModule = require('./customerSupportModule');
const logger = require('./logger'); // Assuming you have a logger module
const { redisClient } = require('./redisClient');
const crypto = require('crypto');

async function buildPersonaPrompt(persona, sessionId = null) {
   
    if (!persona) {
        logger.warn(`Persona config is not presnt`);
        return '';
    }
    
    console.log(`Using persona: ${persona}`);
    
    // Start with base persona instructions
    let prompt = `${persona.behaviorInstructions || ''}\n${persona.functionalDirectives || ''}\n${persona.knowledgeConstraints || ''}\n${persona.ethicalGuidelines || ''}\n`;
    
    // If a sessionId is provided, try to fetch and append customer context
    if (sessionId) {
        // We actually get userName so we need to look up the userId 
        
        
        const userId = global.getUserIdFromSessionId ? global.getUserIdFromSessionId(sessionId) : sessionId;
        console.log(`Adding customer Information for : ${userId}`);
        try {
            // Use buildCustomerProfile from customerSupportModule to get customer details
            const customerProfile = await customerSupportModule.buildCustomerProfile(userId);
            
            // Append customer context to the persona prompt
            prompt += `\n\nCustomer Context:\n`;
            prompt += `- Name: ${customerProfile.name}\n`;
            prompt += `- Email: ${customerProfile.email}\n`;
            
            // Add macro requirements if available
            if (customerProfile.macroRequirements) {
                prompt += `- Macro Requirements: ${JSON.stringify(customerProfile.macroRequirements)}\n`;
            }
            
            // Add recent order summary
            if (customerProfile.lastOrders && customerProfile.lastOrders.length > 0) {
                prompt += `Recent Orders:\n`;
                customerProfile.lastOrders.forEach((order, index) => {
                    prompt += `  #${index + 1}: Order ${order.orderId} - ${order.status} - ${order.amount} on ${order.createdAt}\n`;
                });
            }
            
            // Add refund policy
            prompt += `\nRefund Policy: ${customerProfile.refundPolicy}\n`;
        } catch (error) {
            logger.warn(`Failed to fetch customer context for userId ${userId}:`, error);
        }
    }
    console.log(`Final prompt: ${prompt}`);
    return prompt;
}

module.exports = buildPersonaPrompt;