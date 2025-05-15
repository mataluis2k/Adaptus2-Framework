const customerSupportModule = require('./customerSupportModule');
const logger = require('./logger');
const { redisClient } = require('./redisClient');
const crypto = require('crypto');

/**
 * Build a system prompt for the LLM that includes tool definitions
 * from the persona configuration and optionally customer context
 * 
 * @param {Object} persona - The persona configuration object
 * @param {string} sessionId - Optional session ID to fetch customer context
 * @return {string} The complete system prompt
 */
async function buildPersonaPrompt(persona, sessionId = null) {
    if (!persona) {
        logger.warn(`Persona config is not present`);
        return '';
    }
    
    console.log(`[buildPersonaPrompt] Using persona: ${JSON.stringify(persona)}`);
    
    // Start with base persona information
    let systemPrompt = `You are a ${persona.description || 'helpful assistant'}

${persona.behaviorInstructions || ''}

${persona.functionalDirectives || ''}

${persona.knowledgeConstraints || ''}

${persona.ethicalGuidelines || ''}
`;

    // Add tool definition section if tools are available
    if (persona.tools && persona.tools.length > 0) {
        systemPrompt += `
\n# AVAILABLE TOOLS

You have access to the following tools:
`;

        // Add detailed information for each tool
        persona.tools.forEach(tool => {
            if (typeof tool === 'string') {
                // Handle the case where tools are just string names
                systemPrompt += `\n## ${tool}\n`;
            } else {
                // Handle the case where tools are detailed objects
                systemPrompt += `
## ${tool.name}
${tool.description || ''}

${tool.when_to_use ? `WHEN TO USE:\n${tool.when_to_use}` : ''}

${tool.required_preconditions ? `REQUIRED PRECONDITIONS:\n${tool.required_preconditions.map(p => `- ${p}`).join('\n')}` : ''}

${tool.parameters ? `PARAMETERS:\n${Object.entries(tool.parameters).map(([paramName, paramInfo]) => {
    return `- ${paramName} (${paramInfo.type || 'any'}${paramInfo.required === false ? ', optional' : ''}): ${paramInfo.description || ''}
        ${paramInfo.examples ? `Examples: ${paramInfo.examples.join(', ')}` : ''}
        ${paramInfo.format_instructions ? `Format: ${paramInfo.format_instructions}` : ''}`;
}).join('\n')}` : ''}

${tool.output_handling ? `OUTPUT HANDLING:
- Success: ${tool.output_handling.success_path || ''}
- Error: ${tool.output_handling.error_path || ''}` : ''}
`;
            }
        });

        // Add tool selection logic if available
        if (persona.tool_selection_logic) {
            systemPrompt += `
\n# TOOL SELECTION LOGIC

${persona.tool_selection_logic.priority_rules ? `PRIORITY RULES:\n${persona.tool_selection_logic.priority_rules.map(rule => `- ${rule}`).join('\n')}` : ''}

${persona.tool_selection_logic.step_by_step_procedure ? `PROCEDURE:\n${persona.tool_selection_logic.step_by_step_procedure.map((step, idx) => `${idx+1}. ${step}`).join('\n')}` : ''}
`;
        }

        // Add example tool usage flows if available
        if (persona.example_flows) {
            systemPrompt += `
\n# EXAMPLE TOOL USAGE FLOWS

${persona.example_flows.map((flow, idx) => `Example ${idx+1}: ${flow.title || ''}
${flow.steps.map((step, stepIdx) => `${stepIdx+1}. ${step}`).join('\n')}`).join('\n\n')}
`;
        } else {
            // Add default example flows for customer support
            systemPrompt += `
\n# EXAMPLE TOOL USAGE FLOWS

Example 1: Customer asks about recent order status
1. Check if order information is already in the customer context
2. If not, use fetch_customer_last_orders with the customer ID
3. Present order information in a clear, formatted way
4. If customer asks for details about a specific order, use database_intent_executor with intent "Get details for order {orderId}"

Example 2: Customer requests a refund
1. First use check_refund_eligibility with the order ID
2. If eligible, confirm with the customer: "I can process a refund for order {orderId}. May I ask the reason for the refund?"
3. Only after confirmation, use issue_refund with orderId, reason, and amount parameters
4. Confirm successful refund processing with timing expectations
`;
        }
    }

    // Handle customer context
    let customerContext = '';
    
    // If a sessionId is provided, try to fetch customer information
    if (sessionId) {
        const userId = global.getUserIdFromSessionId ? global.getUserIdFromSessionId(sessionId) : sessionId;
        console.log(`Fetching customer information for: ${userId}`);
        
        try {
            // Use buildCustomerProfile from customerSupportModule to get customer details
            const customerProfile = await customerSupportModule.buildCustomerProfile(userId);
            
            // Build customer context section
            customerContext += `\n\n# CUSTOMER CONTEXT

- Name: ${customerProfile.name || 'Unknown'}
- Email: ${customerProfile.email || 'Not provided'}
`;

            // Add macro requirements if available
            if (customerProfile.macroRequirements) {
                customerContext += `- Macro Requirements: ${JSON.stringify(customerProfile.macroRequirements)}\n`;
            }
            
            // Add recent order summary
            if (customerProfile.lastOrders && customerProfile.lastOrders.length > 0) {
                customerContext += `\n## Recent Orders
${customerProfile.name}'s recent orders:
`;
                customerProfile.lastOrders.forEach((order, index) => {
                    customerContext += `- Order #${index + 1}: ID: ${order.orderId} | Status: ${order.status} | Amount: ${order.amount} | Date: ${order.createdAt} | Tracking: ${order.trackingNumber || 'Not available'}\n`;
                });
            }
            
            // Add refund policy
            if (customerProfile.refundPolicy) {
                customerContext += `\n## Refund Policy
${customerProfile.refundPolicy}
`;
            }
            
            // Add instructions for using customer context
            customerContext += `
## CUSTOMER CONTEXT USAGE
- Reference this customer information when responding to queries
- Do not ask the customer for information already provided here
- Use the customer's name (${customerProfile.name}) appropriately in your responses
- For any information not available in this context, use the appropriate tools to fetch it
`;
        } catch (error) {
            logger.warn(`Failed to fetch customer context for userId ${userId}:`, error);
            customerContext = '\n\n# CUSTOMER CONTEXT\nNo customer information available.';
        }
    }

    // Combine system prompt with customer context
    const finalPrompt = systemPrompt + customerContext;
    
    // Log the prompt for debugging (consider logging only in development)
    if (process.env.NODE_ENV === 'development') {
        console.log(`Final prompt: ${finalPrompt}`);
    } else {
        // In production, log a truncated version or just the structure
        logger.info(`Built persona prompt with ${finalPrompt.length} characters`);
    }
    
    return finalPrompt;
}

module.exports = buildPersonaPrompt;