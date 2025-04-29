// customerSupportModule.js (CommonJS Version)

const { DynamicTool } = require("langchain/tools");
const { getDbConnection } = require("./db");
const { redisClient } = require('./redisClient');
const crypto = require('crypto');

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

async function buildCustomerProfile(userId) {
  console.log(`[buildCustomerProfile] Building profile for userId: ${userId}`);
  const profile = await redisClient.get("customerProfile:" + userId);
  if (profile) {
    console.log(`[buildCustomerProfile] Using cached profile for userId: ${userId}`);
    return JSON.parse(profile);
  }
  
  const db = await getDbConnection(SUPPORT_DB_CONFIG);
  let orders = [];
  const [userResult] = await db.execute(USER_PROFILE_QUERY, [userId]);
  const user = userResult[0] || {};

  // Get order history if query is defined
  if(process.env.ORDER_HISTORY_QUERY) {
    const [orderResults] = await db.execute(ORDER_HISTORY_QUERY, [userId]);
    orders = orderResults.map(order => ({
      orderId: order.external_order_id,
      status: order.status,
      amount: `$${(order.amount / 100).toFixed(2)}`,
      createdAt: order.created_at,
      trackingNumber: order.tracking_number,
      items: JSON.parse(order.items || '[]')
    }));
  }
  
  // Get customer notes if available
  let customerNotes = "";
  try {
    if (process.env.CUSTOMER_NOTES_QUERY) {
      const [notesResult] = await db.execute(CUSTOMER_NOTES_QUERY, [userId]);
      customerNotes = notesResult[0]?.notes || "";
    }
  } catch (error) {
    console.error(`[buildCustomerProfile] Error fetching customer notes: ${error.message}`);
  }
  
  // Get loyalty points if available
  let loyaltyPoints = 0;
  try {
    if (process.env.LOYALTY_POINTS_QUERY) {
      const [pointsResult] = await db.execute(LOYALTY_POINTS_QUERY, [userId]);
      loyaltyPoints = pointsResult[0]?.points_balance || 0;
    }
  } catch (error) {
    console.error(`[buildCustomerProfile] Error fetching loyalty points: ${error.message}`);
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
  console.log(`[buildCustomerProfile] Cached profile for userId: ${userId}`);
  return userObject;
}

// Define all DynamicTools with configurable SQL
const issueRefundTool = new DynamicTool({
  name: "issue_refund",
  description: "Issue a refund for an order if eligible. Provide orderId.",
  func: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(REFUND_UPDATE_QUERY, [orderId]);
    return `Refund successfully issued for order ${orderId}.`;
  }
});

const fetchTrackingInfoTool = new DynamicTool({
  name: "fetch_tracking_info",
  description: "Get tracking link for a shipment. Provide orderId.",
  func: async ({ orderId }) => {
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
  func: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(REFUND_ELIGIBILITY_QUERY, [orderId]);
    const orderDate = result[0]?.created_at;
    if (!orderDate) return `Order not found.`;

    const orderDateObj = new Date(orderDate);
    const today = new Date();
    const diffDays = Math.floor((today - orderDateObj) / (1000 * 60 * 60 * 24));

    if (diffDays <= REFUND_POLICY_DAYS) {
      return `Order ${orderId} is eligible for refund (purchased ${diffDays} days ago).`;
    }
    return `Order ${orderId} is NOT eligible for refund (purchased ${diffDays} days ago).`;
  }
});

const summarizeLastOrdersTool = new DynamicTool({
  name: "summarize_last_orders",
  description: "Summarize a customer's last orders into readable text.",
  func: async ({ userId }) => {
    const profile = await buildCustomerProfile(userId);
    return profile.lastOrders.map(order =>
      `Order ${order.orderId}: ${order.status} for ${order.amount} on ${order.createdAt}`
    ).join("\n");
  }
});

const updateOrderNotesTool = new DynamicTool({
  name: "update_order_notes",
  description: "Add a customer service note to an order.",
  func: async ({ orderId, note }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(ORDER_NOTES_UPDATE_QUERY, [`\n${note}`, orderId]);
    return `Note successfully added to order ${orderId}.`;
  }
});

// New tools for customer service agents

const fetchOrderDetailsTool = new DynamicTool({
  name: "fetch_order_details",
  description: "Get detailed information about a specific order. Provide orderId.",
  func: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(ORDER_DETAIL_QUERY, [orderId]);
    if (!result || result.length === 0) return `Order ${orderId} not found.`;
    
    const order = result[0];
    return JSON.stringify({
      orderId: order.external_order_id,
      status: order.status,
      amount: `$${(order.amount / 100).toFixed(2)}`,
      createdAt: order.created_at,
      trackingNumber: order.tracking_number || "Not shipped",
      items: JSON.parse(order.items || '[]'),
      notes: order.notes || "",
      refundedAt: order.refunded_at || null
    }, null, 2);
  }
});

const addCustomerNoteTool = new DynamicTool({
  name: "add_customer_note",
  description: "Add a note to a customer's profile. Provide userId and note.",
  func: async ({ userId, note, agentId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(ADD_CUSTOMER_NOTE_QUERY, [userId, note, agentId || "system"]);
    await redisClient.del("customerProfile:" + userId); // Invalidate cache
    return `Note successfully added to customer profile for user ${userId}.`;
  }
});

const checkReturnStatusTool = new DynamicTool({
  name: "check_return_status",
  description: "Check the status of a return request for an order. Provide orderId.",
  func: async ({ orderId }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    const [result] = await db.execute(RETURN_STATUS_QUERY, [orderId]);
    if (!result || result.length === 0) return `No return requests found for order ${orderId}.`;
    
    const returnRequest = result[0];
    return `Return for order ${orderId}: Status - ${returnRequest.status}, Reason - ${returnRequest.reason}, Created on - ${returnRequest.created_at}`;
  }
});

const createReturnRequestTool = new DynamicTool({
  name: "create_return_request",
  description: "Create a new return request for an order. Provide orderId and reason.",
  func: async ({ orderId, reason }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(CREATE_RETURN_QUERY, [orderId, reason]);
    return `Return request created successfully for order ${orderId}.`;
  }
});

const checkLoyaltyPointsTool = new DynamicTool({
  name: "check_loyalty_points",
  description: "Check a customer's loyalty points balance. Provide userId.",
  func: async ({ userId }) => {
    const profile = await buildCustomerProfile(userId);
    return `Customer ${profile.name} has ${profile.loyaltyPoints} loyalty points.`;
  }
});

const addLoyaltyPointsTool = new DynamicTool({
  name: "add_loyalty_points",
  description: "Add loyalty points to a customer's account. Provide userId and points.",
  func: async ({ userId, points }) => {
    const db = await getDbConnection(SUPPORT_DB_CONFIG);
    await db.execute(ADD_LOYALTY_POINTS_QUERY, [userId, points, points]);
    await redisClient.del("customerProfile:" + userId); // Invalidate cache
    return `Added ${points} loyalty points to customer ${userId}'s account.`;
  }
});

const clearCustomerCacheTool = new DynamicTool({
  name: "clear_customer_cache",
  description: "Clear the cached customer profile to fetch fresh data. Provide userId.",
  func: async ({ userId }) => {
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

module.exports = {
  buildCustomerProfile,
  preloadCustomerContext,
  customerSupportTools: [
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
    clearCustomerCacheTool
  ]
};