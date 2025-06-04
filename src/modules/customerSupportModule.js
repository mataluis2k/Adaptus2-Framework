// customerSupportModule.js (CommonJS Version)

//const { DynamicTool } = require("langchain/tools");
const { getDbConnection } = require("./db");
const { redisClient } = require('./redisClient');
const crypto = require('crypto');
const { createDatabaseIntentTool } = require('./database-intent-tool');
// New GlogalToolRegistry
const toolRegistry = require('./GlobalToolRegistry');
const { DynamicTool } = require('./DynamicTool');

// Database configuration
const SUPPORT_DB_CONFIG = { dbType: "mysql", dbConnection: "MYSQL_1" };
const USER_PROFILE_QUERY = process.env.USER_PROFILE_QUERY || "SELECT name, email, meta FROM users_v2 WHERE id = ? LIMIT 1";
const ORDER_HISTORY_QUERY = process.env.ORDER_HISTORY_QUERY || `
  SELECT external_order_id, status, amount, created_at, tracking_number, items
  FROM view_order_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
`;
const ORDER_HISTORY_TABLE = process.env.ORDER_HISTORY_TABLE || "view_order_history";
const ORDER_HISTORY_CONDITION = process.env.ORDER_HISTORY_CONDITION || "user_id = ?";
const ORDER_HISTORY_FIELDS = process.env.ORDER_HISTORY_FIELDS || `external_order_id, status, amount, created_at, tracking_number, items`;
const ORDER_HISTORY_LIMIT = process.env.ORDER_HISTORY_LIMIT || 5;
const ORDER_HISTORY_SORT = process.env.ORDER_HISTORY_SORT || "created_at DESC";
const CACHE_DURATION = process.env.CACHE_DURATION || 3600; // Default: 1 hour
const REFUND_POLICY_DAYS = process.env.REFUND_POLICY_DAYS || 30;

  
// Additional SQL queries for new tools
const REFUND_UPDATE_QUERY = process.env.REFUND_UPDATE_QUERY || 
  `UPDATE ${ORDER_HISTORY_TABLE} SET status = 'Refunded', refunded_at = NOW() WHERE external_order_id = ?`;
const TRACKING_INFO_QUERY = process.env.TRACKING_INFO_QUERY || 
  `SELECT tracking_number FROM ${ORDER_HISTORY_TABLE} WHERE external_order_id = ? LIMIT 1`;
const REFUND_ELIGIBILITY_QUERY = process.env.REFUND_ELIGIBILITY_QUERY || 
  `SELECT created_at FROM ${ORDER_HISTORY_TABLE} WHERE external_order_id = ? LIMIT 1`;
const ORDER_NOTES_UPDATE_QUERY = process.env.ORDER_NOTES_UPDATE_QUERY || 
  `UPDATE ${ORDER_HISTORY_TABLE} SET notes = CONCAT(IFNULL(notes, ''), ?) WHERE external_order_id = ?`;
const ORDER_DETAIL_QUERY = process.env.ORDER_DETAIL_QUERY || 
  `SELECT * FROM ${ORDER_HISTORY_TABLE} WHERE external_order_id = ? LIMIT 1`;
const CUSTOMER_NOTES_QUERY = process.env.CUSTOMER_NOTES_QUERY || '';
  // `SELECT notes FROM customer_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`;
const ADD_CUSTOMER_NOTE_QUERY = process.env.ADD_CUSTOMER_NOTE_QUERY || 
  `INSERT INTO customer_notes (user_id, notes, created_by) VALUES (?, ?, ?)`;
const RETURN_STATUS_QUERY = process.env.RETURN_STATUS_QUERY || 
  `SELECT * FROM returns WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`;
const CREATE_RETURN_QUERY = process.env.CREATE_RETURN_QUERY || 
  `INSERT INTO returns (order_id, reason, status, created_at) VALUES (?, ?, 'Pending', NOW())`;
const LOYALTY_POINTS_QUERY = process.env.LOYALTY_POINTS_QUERY || '';
  // `SELECT points_balance FROM customer_loyalty WHERE user_id = ? LIMIT 1`;
const ADD_LOYALTY_POINTS_QUERY = process.env.ADD_LOYALTY_POINTS_QUERY || 
  `INSERT INTO customer_loyalty (user_id, points_balance, last_updated) VALUES (?, ?, NOW()) 
   ON DUPLICATE KEY UPDATE points_balance = points_balance + ?, last_updated = NOW()`;
/**
 * Correctly formats a date string from the database
 * @param {string|Date} dateInput - Date string in format "YYYY-MM-DD HH:MM:SS" or Date object
 * @returns {string} - Formatted date string
 */
function formatDateFromDatabase(dateInput) {
  // Check if the input is null or undefined
  if (!dateInput) {
    console.warn('Invalid date input received:', dateInput);
    return 'Date unavailable';
  }

  try {
    let date;
    
    // Handle Date object input
    if (dateInput instanceof Date) {
      date = dateInput;
    }
    // Handle string input
    else if (typeof dateInput === 'string') {
      // Try direct Date parsing first (handles ISO strings well)
      date = new Date(dateInput);
      
      // If direct parsing fails, try manual parsing
      if (isNaN(date.getTime())) {
        const parts = dateInput.split(/[- :]/);
        if (parts.length < 6) {
          console.warn('Date string has incorrect format:', dateInput);
          return 'Date format error';
        }
        
        // Parts should be [year, month, day, hour, minute, second]
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // JavaScript months are 0-based
        const day = parseInt(parts[2], 10);
        const hour = parseInt(parts[3], 10);
        const minute = parseInt(parts[4], 10);
        const second = parseInt(parts[5], 10);
        
        date = new Date(year, month, day, hour, minute, second);
      }
    } 
    // Handle unexpected input types
    else {
      console.warn('Unexpected date input type:', typeof dateInput);
      return 'Date unavailable';
    }
    
    // Check if the date is valid
    if (isNaN(date.getTime())) {
      console.warn('Invalid date created from input:', dateInput);
      return 'Invalid date';
    }
    
    // Format the date as a readable string
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.error('Error formatting date:', error, 'Input:', dateInput);
    return 'Date parsing error';
  }
}

async function  buildCustomerProfile(userId) {
  console.log(`[buildCustomerProfile1] Building profile for userId: ${userId}`);
  // need to put an expiration on the cache

  const profile = await redisClient.get("customerProfile:" + userId);
  if (profile) {
    console.log(`[buildCustomerProfile2] Using cached profile for userId: ${userId}`);
    return JSON.parse(profile);
  }
  
  const db = await getDbConnection(SUPPORT_DB_CONFIG);
  let orders = [];
  const [userResult] = await db.execute(USER_PROFILE_QUERY, [userId]);
  const user = userResult[0] || {};
  try{
      // Get order history if query is defined
      if(process.env.ORDER_HISTORY_QUERY) {
        const [orderResults] = await db.execute(ORDER_HISTORY_QUERY, [userId]);
        console.log("Order historyt results:", JSON.stringify(orderResults));
        orders = orderResults.map(order => {
          let parsedItems;
          
          // Check if items is already an object (array)
          if (Array.isArray(order.items)) {
            parsedItems = order.items;
          } else {
            // Try to parse as JSON if it's a string
            try {
              parsedItems = JSON.parse(order.items || '[]');
            } catch (err) {
              console.warn(`Failed to parse order items for order ${order.external_order_id}: ${err.message}`);
              parsedItems = [];
            }
          }
          if (order.tracking_number === null || order.tracking_number === undefined) {
            order.tracking_number = "Tracking number not available";
          }
          return {
            orderId: order.external_order_id,
            status: order.status,
            amount: `$${order.amount}`,
            createdAt: formatDateFromDatabase(order.created_at),
            trackingNumber: order.tracking_number,
            items: parsedItems
          };
        });
      }
    } catch (error) {
      console.error(`[buildCustomerProfile3] Error fetching order history: ${error.message}`);
      orders = [];
  }
  // Get customer notes if available
  let customerNotes = "";
  try {
    if (process.env.CUSTOMER_NOTES_QUERY) {
      const [notesResult] = await db.execute(CUSTOMER_NOTES_QUERY, [userId]);
      customerNotes = notesResult[0]?.notes || "";
    }
  } catch (error) {
    console.error(`[buildCustomerProfile4] Error fetching customer notes: ${error.message}`);
  }
  
  // Get loyalty points if available
  let loyaltyPoints = 0;
  try {
    if (process.env.LOYALTY_POINTS_QUERY) {
      const [pointsResult] = await db.execute(LOYALTY_POINTS_QUERY, [userId]);
      loyaltyPoints = pointsResult[0]?.points_balance || 0;
    }
  } catch (error) {
    console.error(`[buildCustomerProfile5] Error fetching loyalty points: ${error.message}`);
  }
  
  const meta = user.meta || '{}';
  const userObject = {
    name: user.name || "",
    email: user.email || "",
    macroRequirements: meta,
    lastOrders: orders,
    refundPolicy: `Refunds allowed within ${REFUND_POLICY_DAYS} days if items are unopened.`,
    customerNotes: customerNotes,
    loyaltyPoints: loyaltyPoints
  };
  
  await redisClient.set("customerProfile:" + userId, JSON.stringify(userObject), 'EX', CACHE_DURATION);
  console.log(`[buildCustomerProfile6] Cached profile for userId: ${userId}`);
  return userObject;
}

// Define all DynamicTools with configurable SQL
const issueRefundTool = new DynamicTool({
  name: "issue_refund",
  description: "Issue a refund for an order if eligible. Provide orderId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to refund'
    }
  },
  execute: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(REFUND_UPDATE_QUERY, [orderId]);
    return `Refund successfully issued for order ${orderId}.`;
  }
});

const fetchCustomerLastOrdersTool = new DynamicTool({
  name: "fetch_customer_last_orders",
  description: "Fetch the last orders of a customer. Provide userId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    userId: {
      type: 'string',
      description: 'User ID to fetch orders for Customer'
    }
  },
  execute: async ({ userId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(FIND_CUSTOMER_LAST_ORDERS, [userId]);
    if (!result || result.length === 0) return `No orders found for user ${userId}.`;
    const orders = result.map(order => ({
      orderId: order.purchase_id,
      status: order.status,
      amount: `$${(order.revenue / 100).toFixed(2)}`,
      createdAt: formatDateFromDatabase(order.created_at),
      trackingNumber: order.tracking_number,
      items: JSON.parse(order.items || '[]')
    }));
    return orders.map(order =>
      `Order ${order.orderId}: ${order.status} for ${order.amount} on ${order.createdAt}`
    ).join("\n");
  }
});

const fetchTrackingInfoTool = new DynamicTool({
  name: "fetch_tracking_info",
  description: "Get tracking link for a shipment. Provide orderId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to lookup tracking info'
    }
  },
  execute: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(TRACKING_INFO_QUERY, [orderId]);
    const tracking = result[0]?.tracking_number;
    if (!tracking) return `No tracking info found for order ${orderId}`;
    return `Tracking link: https://track.example.com/${tracking}`;
  }
});

const checkRefundEligibilityTool = new DynamicTool({
  name: "check_refund_eligibility",
  description: "Check if an order is eligible for refund based on purchase date.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to find eligibility'
    }
  },
  execute: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(REFUND_ELIGIBILITY_QUERY, [orderId]);
    const orderDate = result[0]?.created_at;
    const query = REFUND_ELIGIBILITY_QUERY;
    console.log(`[TOOL_DEBUG] Executing SQL: ${query}`);
    console.log(`[TOOL_DEBUG] With parameters:`, JSON.stringify([orderId]));
    console.log(`[TOOL_DEBUG] Order date: ${orderDate}`);
    if (!orderDate) return `Order not found.`;

    let orderDateObj;
    
    try {
      // Try direct Date parsing first
      orderDateObj = new Date(orderDate);
      
      // If parsing fails, use our custom date parsing
      if (isNaN(orderDateObj.getTime())) {
        // Try manual parsing through formatDateFromDatabase, but we need the Date object here
        const parts = orderDate.split(/[- :]/);
        if (parts.length >= 6) {
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1; // JavaScript months are 0-based
          const day = parseInt(parts[2], 10);
          const hour = parseInt(parts[3], 10);
          const minute = parseInt(parts[4], 10);
          const second = parseInt(parts[5], 10);
          
          orderDateObj = new Date(year, month, day, hour, minute, second);
        } else {
          return `Order date format error for order ${orderId}.`;
        }
      }
    } catch (error) {
      console.error(`Error parsing order date: ${error}`, orderDate);
      return `Error calculating refund eligibility for order ${orderId}.`;
    }
    
    if (isNaN(orderDateObj.getTime())) {
      return `Invalid order date for order ${orderId}.`;
    }
    
    const today = new Date();
    const diffDays = Math.floor((today - orderDateObj) / (1000 * 60 * 60 * 24));

    if (diffDays <= REFUND_POLICY_DAYS) {
      return `Order ${orderId} is eligible for refund (purchased ${diffDays} days ago, on ${formatDateFromDatabase(orderDateObj)}).`;
    }
    return `Order ${orderId} is NOT eligible for refund (purchased ${diffDays} days ago, on ${formatDateFromDatabase(orderDateObj)}).`;
  }
});

const summarizeLastOrdersTool = new DynamicTool({
  name: "summarize_last_orders",
  description: "Summarize a customer's last orders into readable text.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    userId: {
      type: 'string',
      description: 'User ID to fetch orders for Customer'
    }
  },
  execute: async ({ userId }) => {
    const profile = await buildCustomerProfile(userId);
    return profile.lastOrders.map(order =>
      `Order ${order.orderId}: ${order.status} for ${order.amount} on ${order.createdAt}`
    ).join("\n");
  }
});

const updateOrderNotesTool = new DynamicTool({
  name: "update_order_notes",
  description: "Add a customer service note to an order. Use parameters: orderId (or order_id) and note (or notes array).",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to add note to (can also use order_id)'
    },
    note: {
      type: 'string',
      description: 'Note to add to the order (can also use notes as string or array)'
    }
  },
  execute: async (params) => {
    // Handle both parameter formats: { orderId, note } and { order_id, notes }
    const orderId = params.orderId || params.order_id;
    let note = params.note;
    
    // Handle notes array format
    if (!note && params.notes) {
      if (Array.isArray(params.notes)) {
        note = params.notes.join('\n');
      } else {
        note = params.notes;
      }
    }
    
    console.log(`[TOOL_DEBUG] Starting update_order_notes for orderId: ${orderId}, note: ${note}`);
    console.log(`[TOOL_DEBUG] Raw params received:`, JSON.stringify(params));
    
    // Validate parameters
    if (!orderId) {
      return `❌ Error: Missing order ID. Please provide either 'orderId' or 'order_id' parameter.`;
    }
    if (!note) {
      return `❌ Error: Missing note. Please provide either 'note' or 'notes' parameter.`;
    }
    
    try {
      // Get DB connection with extended timeout and debug
      console.log(`[TOOL_DEBUG] Getting database connection with config:`, JSON.stringify(SUPPORT_DB_CONFIG));
      const db = await getDbConnection(SUPPORT_DB_CONFIG);
      
      // Log the exact SQL query we're going to execute
      const query = ORDER_NOTES_UPDATE_QUERY;
      const params = [`\n${note}`, orderId];
      console.log(`[TOOL_DEBUG] Executing SQL: ${query}`);
      console.log(`[TOOL_DEBUG] With parameters:`, JSON.stringify(params));
      
      // Execute the query and capture the result
      const [rows] = await db.execute(query, params);
      const meta = Array.isArray(rows) ? rows[0] : rows;
      const affectedRows = meta?.affectedRows ?? 0;
      console.log(`[TOOL_DEBUG] affectedRows = ${affectedRows}`);
      
      // Check affected rows to verify the update worked
      
      if (affectedRows === 0) {
        console.warn(`[TOOL_DEBUG] Warning: No rows affected when updating notes for order ${orderId}`);
        
        // Try to check if the order exists
        const checkOrderQuery = `SELECT COUNT(*) as count FROM ${ORDER_HISTORY_TABLE} WHERE external_order_id = ?`;
        const [checkResult] = await db.execute(checkOrderQuery, [orderId]);
        const orderExists = checkResult[0]?.count > 0;
        
        if (!orderExists) {
          console.error(`[TOOL_DEBUG] Error: Order ${orderId} does not exist in the database`);
          return `Error: Could not add note to order ${orderId} because the order was not found.`;
        }
      }
      
      // Success response with more details
      return `Note successfully added to order ${orderId}. Database affected rows: ${affectedRows}`;
    } catch (error) {
      // Enhanced error logging
      console.error(`[TOOL_DEBUG] Error updating order notes:`, error);
      console.error(`[TOOL_DEBUG] Error details:`, {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage
      });
      
      // Return detailed error message
      return `Error adding note to order ${orderId}: ${error.message}. Please check the logs for more details.`;
    }
  }
});

// New tools for customer service agents

const fetchOrderDetailsTool = new DynamicTool({
  name: "fetch_order_details",
  description: "Get detailed information about a specific order. Provide orderId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to fetch details for'
    }
  },
  execute: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(ORDER_DETAIL_QUERY, [orderId]);
    if (!result || result.length === 0) return `Order ${orderId} not found.`;
    
    const order = result[0];
    return JSON.stringify({
      orderId: order.external_order_id,
      status: order.status,
      amount: `$${(order.amount / 100).toFixed(2)}`,
      createdAt: formatDateFromDatabase(order.created_at),
      trackingNumber: order.tracking_number || "Not shipped",
      items: JSON.parse(order.items || '[]'),
      notes: order.notes || "",
      refundedAt: order.refunded_at ? formatDateFromDatabase(order.refunded_at) : null
    }, null, 2);
  }
});

const addCustomerNoteTool = new DynamicTool({
  name: "add_customer_note",
  description: "Add a note to a customer's profile. Provide userId and note.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    userId: {
      type: 'string',
      description: 'User ID to add note for'
    },
    note: {
      type: 'string',
      description: 'Note to add'
    },
    agentId: {
      type: 'string',
      description: 'Agent ID adding the note (optional)'
    }
  },
  execute: async ({ userId, note, agentId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(ADD_CUSTOMER_NOTE_QUERY, [userId, note, agentId || "system"]);
    await redisClient.del("customerProfile:" + userId); // Invalidate cache
    return `Note successfully added to customer profile for user ${userId}.`;
  }
});

const checkReturnStatusTool = new DynamicTool({
  name: "check_return_status",
  description: "Check the status of a return request for an order. Provide orderId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to check return status for'
    }
  },
  execute: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(RETURN_STATUS_QUERY, [orderId]);
    if (!result || result.length === 0) return `No return requests found for order ${orderId}.`;
    
    const returnRequest = result[0];
    return `Return for order ${orderId}: Status - ${returnRequest.status}, Reason - ${returnRequest.reason}, Created on - ${formatDateFromDatabase(returnRequest.created_at)}`;
  }
});

const createReturnRequestTool = new DynamicTool({
  name: "create_return_request",
  description: "Create a new return request for an order. Provide orderId and reason.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    orderId: {
      type: 'string',
      description: 'Order ID to create return request for'
    },
    reason: {
      type: 'string',
      description: 'Reason for the return request'
    }
  },
  execute: async ({ orderId, reason }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(CREATE_RETURN_QUERY, [orderId, reason]);
    return `Return request created successfully for order ${orderId}.`;
  }
});

const checkLoyaltyPointsTool = new DynamicTool({
  name: "check_loyalty_points",
  description: "Check a customer's loyalty points balance. Provide userId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    userId: {
      type: 'string',
      description: 'User ID to check loyalty points for'
    }
  },
  execute: async ({ userId }) => {
    const profile = await buildCustomerProfile(userId);
    return `Customer ${profile.name} has ${profile.loyaltyPoints} loyalty points.`;
  }
});

const addLoyaltyPointsTool = new DynamicTool({
  name: "add_loyalty_points",
  description: "Add loyalty points to a customer's account. Provide userId and points.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    userId: {
      type: 'string',
      description: 'User ID to add points for'
    }
  },
  execute: async ({ userId, points }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(ADD_LOYALTY_POINTS_QUERY, [userId, points, points]);
    await redisClient.del("customerProfile:" + userId); // Invalidate cache
    return `Added ${points} loyalty points to customer ${userId}'s account.`;
  }
});

const clearCustomerCacheTool = new DynamicTool({
  name: "clear_customer_cache",
  description: "Clear the cached customer profile to fetch fresh data. Provide userId.",
  category: "customer_support",
  requiresAuth: true,
  schema: {
    userId: {
      type: 'string',
      description: 'User ID to clear cache for'
    }
  },
  execute: async ({ userId }) => {
    await redisClient.del("customerProfile:" + userId);
    return `Cache cleared for customer ${userId}. Next profile request will fetch fresh data.`;
  }
});

async function preloadCustomerContext(sessionId, userId) {
  const profile = await buildCustomerProfile(userId);
  console.log(`[preloadCustomerContext] Preloading context for sessionId: ${sessionId}`);

  const context = `
Customer Name: ${profile.name}
Email: ${profile.email}
Macro Requirements: ${profile.macroRequirements}
Refund Policy: ${profile.refundPolicy}
Loyalty Points: ${profile.loyaltyPoints}

Recent Orders:
${profile.lastOrders.map((order, idx) => `#${idx + 1}: Order ${order.orderId} - ${order.status} - ${order.amount} on ${order.createdAt}`).join("\n")}

Customer Notes:
${profile.customerNotes || "No notes available"}
  `;

  // await llmModule.addToHistory(sessionId, context, 'system');
}

const customerSupportTools = [
    issueRefundTool,
    fetchTrackingInfoTool,
    checkRefundEligibilityTool,
    summarizeLastOrdersTool,
    updateOrderNotesTool,
    fetchOrderDetailsTool,
    addCustomerNoteTool,
    checkReturnStatusTool,
    createReturnRequestTool,
    checkLoyaltyPointsTool,
    addLoyaltyPointsTool,
    clearCustomerCacheTool,
    fetchCustomerLastOrdersTool
  ];
try {
  toolRegistry.registerModuleTools(customerSupportTools, 'customer_support', 'customerSupportModule');
}
catch (error) {
  console.error(`[customerSupportModule] Error registering tools: ${error.message}`);
}

module.exports = {
  buildCustomerProfile,
  preloadCustomerContext,
  customerSupportTools,
  
};