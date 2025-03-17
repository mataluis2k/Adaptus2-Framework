/**
 * @fileoverview Customer Lifetime Value Prediction Middleware
 * 
 * This middleware handles API requests for the Customer Lifetime Value (CLV) prediction model.
 * It provides endpoints for getting CLV predictions for specific customers, batch predictions,
 * and detailed model information.
 * 
 * @module middleware/customer_lifetime_value_middleware
 * @requires ../db
 * @requires ../logger
 * @requires tensorflow/tfjs-node
 */

const tf = require('@tensorflow/tfjs-node');
const consolelog = require('../../modules/logger');
const { executeQuery, executeCountQuery, formatError } = require('../middleware_utils');

/**
 * Main middleware handler for CLV prediction requests
 * 
 * @async
 * @function handler
 * @param {string} table - Database table name
 * @param {number|null} keyId - Optional key ID for specific customer
 * @param {boolean} detailed - Whether to return detailed information
 * @param {Object} modelData - Model data from model handler
 * @param {Object} connection - Database connection
 * @param {Object} req - Express request object (for body access)
 * @param {Object} res - Express response object
 * @returns {Object} API response with predictions or model info
 */
async function handler(table, keyId, detailed, modelData, connection, req, res) {
    try {
        // Check if model exists and has no errors
        if (!modelData || modelData.error) {
            return {
                error: modelData?.error || 'Model not found',
                message: modelData?.message || `CLV prediction model for ${table} not available`
            };
        }

        // If request contains a batch of customers for prediction
        if (req.body && Array.isArray(req.body.customers)) {
            return await handleBatchPrediction(modelData, req.body.customers);
        }

        // If a specific customer ID is provided
        if (keyId !== null) {
            return await handleSingleCustomerPrediction(table, keyId, modelData, connection);
        }

        // Return model information (detailed or summary)
        return handleModelInfo(table, modelData, detailed, connection);
    } catch (error) {
        consolelog.error(`Error in CLV prediction middleware for ${table}:`, error);
        return formatError('Internal server error in CLV prediction middleware', error.message);
    }
}

/**
 * Handle batch prediction requests
 * 
 * @async
 * @function handleBatchPrediction
 * @param {Object} modelData - Model data
 * @param {Array<Object>} customers - Customer data for prediction
 * @returns {Object} Batch prediction results
 */
async function handleBatchPrediction(modelData, customers) {
    if (!modelData.tfModel) {
        return formatError('Model not ready', 'TensorFlow model not available');
    }
    
    try {
        // Process customer data
        const processedFeatures = [];
        const customerIds = [];
        
        for (const customer of customers) {
            // Extract features based on model's feature info
            const customerFeatures = extractCustomerFeatures(customer, modelData.featureInfo);
            
            if (customerFeatures) {
                processedFeatures.push(customerFeatures);
                customerIds.push(customer.id || customer.customer_id || 'unknown');
            }
        }
        
        if (processedFeatures.length === 0) {
            return {
                message: 'No valid customer data for prediction',
                predictions: []
            };
        }
        
        // Convert to tensor and make predictions
        const inputTensor = tf.tensor2d(processedFeatures);
        const predictionsTensor = modelData.tfModel.predict(inputTensor);
        const predictions = await predictionsTensor.array();
        
        // Clean up tensors
        inputTensor.dispose();
        predictionsTensor.dispose();
        
        // Format response
        return {
            predictions: customerIds.map((id, index) => ({
                customerId: id,
                predictedLTV: parseFloat(predictions[index][0].toFixed(2)),
                confidence: calculateConfidence(predictions[index][0], modelData)
            }))
        };
    } catch (error) {
        consolelog.error('Error in CLV batch prediction:', error);
        return formatError('Prediction error', error.message);
    }
}

/**
 * Handle prediction for a single customer
 * 
 * @async
 * @function handleSingleCustomerPrediction
 * @param {string} table - Database table
 * @param {number} customerId - Customer ID
 * @param {Object} modelData - Model data
 * @param {Object} connection - Database connection
 * @returns {Object} Prediction result
 */
async function handleSingleCustomerPrediction(table, customerId, modelData, connection) {
    try {
        // Fetch customer data
        const customerData = await fetchCustomerData(table, customerId, connection);
        
        if (!customerData) {
            return formatError('Customer not found', `Customer with ID ${customerId} not found`);
        }
        
        // Extract features
        const features = extractCustomerFeatures(customerData, modelData.featureInfo);
        
        if (!features) {
            return formatError('Feature extraction failed', 'Could not extract valid features');
        }
        
        // Make prediction
        const inputTensor = tf.tensor2d([features]);
        const predictionTensor = modelData.tfModel.predict(inputTensor);
        const predictionArray = await predictionTensor.array();
        const predictedLTV = predictionArray[0][0];
        
        // Clean up tensors
        inputTensor.dispose();
        predictionTensor.dispose();
        
        // Get additional customer insights
        const insights = generateCustomerInsights(customerData, predictedLTV, modelData);
        
        // Format response
        return {
            customerId,
            predictedLTV: parseFloat(predictedLTV.toFixed(2)),
            confidence: calculateConfidence(predictedLTV, modelData),
            percentile: calculatePercentile(predictedLTV, modelData),
            insights,
            recommendedActions: generateRecommendedActions(predictedLTV, insights, modelData)
        };
    } catch (error) {
        consolelog.error(`Error predicting CLV for customer ${customerId}:`, error);
        return formatError('Prediction error', error.message);
    }
}

/**
 * Handle model information request
 * 
 * @async
 * @function handleModelInfo
 * @param {string} table - Database table
 * @param {Object} modelData - Model data
 * @param {boolean} detailed - Whether to return detailed info
 * @param {Object} connection - Database connection
 * @returns {Object} Model information
 */
async function handleModelInfo(table, modelData, detailed, connection) {
    // Basic model info
    const response = {
        modelType: 'customer_lifetime_value',
        table,
        lastUpdated: modelData.timestamp,
        status: 'active',
        performance: {
            rmse: modelData.performance.rmse,
            r2: modelData.performance.rSquared
        },
        config: {
            targetField: modelData.config.targetField,
            predictionHorizon: modelData.config.predictionHorizon
        },
        statistics: {
            averageLTV: modelData.statistics.averageLTV,
            medianLTV: modelData.statistics.medianLTV
        }
    };
    
    // If detailed info is requested
    if (detailed) {
        // Get distribution of actual LTV values
        let distributionData = [];
        try {
            distributionData = await fetchLTVDistribution(table, modelData.config.targetField, connection);
        } catch (error) {
            consolelog.warn(`Error fetching LTV distribution for ${table}:`, error);
        }
        
        // Add detailed information
        response.detailedInfo = {
            performance: modelData.performance,
            features: modelData.featureInfo.map(f => f.field),
            statistics: modelData.statistics,
            distribution: distributionData,
            samplePredictions: modelData.predictions || []
        };
    }
    
    return response;
}

/**
 * Extract features for a customer
 * 
 * @function extractCustomerFeatures
 * @param {Object} customer - Customer data
 * @param {Array<Object>} featureInfo - Feature information
 * @returns {Array<number>|null} Extracted feature vector
 */
function extractCustomerFeatures(customer, featureInfo) {
    try {
        const features = [];
        
        // Extract basic features
        for (const fieldInfo of featureInfo) {
            const field = fieldInfo.field;
            
            // Skip RFM features (they'll be handled separately)
            if (['recency', 'frequency', 'monetary'].includes(field)) {
                continue;
            }
            
            // Get value and process it
            let value = customer[field];
            let processedValue;
            
            if (value === undefined || value === null) {
                // Use default values based on field type
                if (fieldInfo.type === 'numeric' || fieldInfo.type === 'date') {
                    processedValue = 0;
                } 
                else if (fieldInfo.type === 'boolean') {
                    processedValue = 0;
                }
                else if (fieldInfo.type === 'categorical') {
                    processedValue = Array(fieldInfo.processor?.categories?.length || 0).fill(0);
                }
            } else {
                // Process field based on type
                if (fieldInfo.processor) {
                    if (fieldInfo.type === 'numeric' || fieldInfo.type === 'date') {
                        processedValue = fieldInfo.processor.process([value])[0];
                    } 
                    else if (fieldInfo.type === 'boolean') {
                        processedValue = value ? 1 : 0;
                    }
                    else if (fieldInfo.type === 'categorical') {
                        const { encoded } = oneHotEncode(value, fieldInfo.processor.categories);
                        processedValue = encoded;
                    }
                }
            }
            
            // Add to feature vector
            if (Array.isArray(processedValue)) {
                features.push(...processedValue);
            } else if (processedValue !== undefined) {
                features.push(processedValue);
            }
        }
        
        // Add RFM features if available
        const rfmFeatures = calculateRFMFeatures(customer, featureInfo);
        features.push(...rfmFeatures);
        
        return features;
    } catch (error) {
        consolelog.error('Error extracting customer features:', error);
        return null;
    }
}

/**
 * Calculate RFM features for a customer
 * 
 * @function calculateRFMFeatures
 * @param {Object} customer - Customer data
 * @param {Array<Object>} featureInfo - Feature information
 * @returns {Array<number>} RFM features
 */
function calculateRFMFeatures(customer, featureInfo) {
    // Default RFM values
    const defaultRFM = [0.5, 0.5, 0.5];
    
    // Find RFM feature info
    const recencyInfo = featureInfo.find(f => f.field === 'recency');
    const frequencyInfo = featureInfo.find(f => f.field === 'frequency');
    const monetaryInfo = featureInfo.find(f => f.field === 'monetary');
    
    // If we don't have RFM info, return defaults
    if (!recencyInfo || !frequencyInfo || !monetaryInfo) {
        return defaultRFM;
    }
    
    // Calculate recency
    let recency = 0.5;
    if (customer.last_purchase_date || customer.last_order_date) {
        const lastPurchaseDate = new Date(customer.last_purchase_date || customer.last_order_date);
        const now = new Date();
        const daysSinceLastPurchase = Math.max(0, Math.floor((now - lastPurchaseDate) / (1000 * 60 * 60 * 24)));
        
        if (recencyInfo.processor && recencyInfo.processor.params) {
            const { min, max } = recencyInfo.processor.params;
            recency = Math.max(0, Math.min(1, (daysSinceLastPurchase - min) / (max - min)));
        } else {
            // Rough estimate: 0 days = 1, 365+ days = 0
            recency = Math.max(0, Math.min(1, 1 - (daysSinceLastPurchase / 365)));
        }
    }
    
    // Calculate frequency
    let frequency = 0.5;
    if (customer.order_count || customer.purchase_count || customer.frequency) {
        const orderCount = customer.order_count || customer.purchase_count || customer.frequency || 1;
        
        if (frequencyInfo.processor && frequencyInfo.processor.params) {
            const { min, max } = frequencyInfo.processor.params;
            frequency = Math.max(0, Math.min(1, (orderCount - min) / (max - min)));
        } else {
            // Rough estimate: 1 order = 0, 20+ orders = 1
            frequency = Math.max(0, Math.min(1, (orderCount - 1) / 19));
        }
    }
    
    // Calculate monetary
    let monetary = 0.5;
    if (customer.average_order_value || customer.avg_order_value || customer.monetary) {
        const avgOrderValue = customer.average_order_value || customer.avg_order_value || customer.monetary || 0;
        
        if (monetaryInfo.processor && monetaryInfo.processor.params) {
            const { min, max } = monetaryInfo.processor.params;
            monetary = Math.max(0, Math.min(1, (avgOrderValue - min) / (max - min)));
        } else {
            // Rough estimate: $0 = 0, $200+ = 1
            monetary = Math.max(0, Math.min(1, avgOrderValue / 200));
        }
    }
    
    return [recency, frequency, monetary];
}

/**
 * Calculate confidence score for prediction
 * 
 * @function calculateConfidence
 * @param {number} prediction - Predicted LTV value
 * @param {Object} modelData - Model data
 * @returns {number} Confidence score (0-1)
 */
function calculateConfidence(prediction, modelData) {
    // Calculate confidence based on model performance and prediction value
    const { mape, rmse } = modelData.performance;
    const { averageLTV, maxLTV } = modelData.statistics;
    
    // Higher confidence when prediction is closer to average (more data points)
    const distanceFromMean = Math.abs(prediction - averageLTV) / averageLTV;
    const meanConfidence = Math.max(0, Math.min(1, 1 - distanceFromMean));
    
    // Lower confidence for extreme values
    const rangeConfidence = Math.max(0, Math.min(1, 1 - (prediction / (maxLTV * 1.2))));
    
    // Lower confidence for higher error models
    const errorConfidence = Math.max(0, Math.min(1, 1 - (mape / 100)));
    
    // Combine factors
    const confidence = (meanConfidence * 0.5) + (rangeConfidence * 0.2) + (errorConfidence * 0.3);
    
    return parseFloat(confidence.toFixed(2));
}

/**
 * Calculate percentile of predicted LTV
 * 
 * @function calculatePercentile
 * @param {number} prediction - Predicted LTV value
 * @param {Object} modelData - Model data
 * @returns {number} Percentile (0-100)
 */
function calculatePercentile(prediction, modelData) {
    const { minLTV, maxLTV, medianLTV } = modelData.statistics;
    
    // Simple percentile calculation
    if (prediction <= minLTV) return 0;
    if (prediction >= maxLTV) return 100;
    
    // Estimate percentile based on min, median, max
    if (prediction <= medianLTV) {
        return Math.round((prediction - minLTV) / (medianLTV - minLTV) * 50);
    } else {
        return 50 + Math.round((prediction - medianLTV) / (maxLTV - medianLTV) * 50);
    }
}

/**
 * Generate customer insights
 * 
 * @function generateCustomerInsights
 * @param {Object} customer - Customer data
 * @param {number} predictedLTV - Predicted LTV
 * @param {Object} modelData - Model data
 * @returns {Object} Customer insights
 */
function generateCustomerInsights(customer, predictedLTV, modelData) {
    const insights = {
        valueSegment: classifyCustomerValue(predictedLTV, modelData),
        riskFactors: [],
        growthOpportunities: []
    };
    
    // Analyze recency
    if (customer.last_purchase_date || customer.last_order_date) {
        const lastPurchaseDate = new Date(customer.last_purchase_date || customer.last_order_date);
        const now = new Date();
        const daysSinceLastPurchase = Math.floor((now - lastPurchaseDate) / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastPurchase > 180) {
            insights.riskFactors.push({
                factor: 'High recency',
                description: `Customer hasn't made a purchase in ${daysSinceLastPurchase} days`
            });
        }
    }
    
    // Analyze frequency
    const orderCount = customer.order_count || customer.purchase_count || 0;
    if (orderCount <= 1) {
        insights.riskFactors.push({
            factor: 'Low purchase frequency',
            description: 'Customer has only made one purchase'
        });
    } else if (orderCount >= 5) {
        insights.growthOpportunities.push({
            opportunity: 'Loyal customer',
            description: `Customer has made ${orderCount} purchases`
        });
    }
    
    // Analyze monetary value
    const avgOrderValue = customer.average_order_value || customer.avg_order_value || 0;
    if (avgOrderValue > modelData.statistics.averageLTV) {
        insights.growthOpportunities.push({
            opportunity: 'High-value customer',
            description: 'Customer spends above average per order'
        });
    }
    
    // Other potential insights
    if (customer.product_categories && Array.isArray(customer.product_categories)) {
        if (customer.product_categories.length === 1) {
            insights.growthOpportunities.push({
                opportunity: 'Cross-selling',
                description: 'Customer purchases from only one product category'
            });
        }
    }
    
    return insights;
}

/**
 * Classify customer value segment
 * 
 * @function classifyCustomerValue
 * @param {number} predictedLTV - Predicted LTV
 * @param {Object} modelData - Model data
 * @returns {string} Value segment
 */
function classifyCustomerValue(predictedLTV, modelData) {
    const { minLTV, maxLTV, averageLTV, medianLTV } = modelData.statistics;
    
    if (predictedLTV >= (averageLTV * 2)) {
        return 'Premium';
    } else if (predictedLTV >= averageLTV) {
        return 'High';
    } else if (predictedLTV >= medianLTV) {
        return 'Medium';
    } else if (predictedLTV >= (minLTV * 2)) {
        return 'Low';
    } else {
        return 'Very Low';
    }
}

/**
 * Generate recommended actions
 * 
 * @function generateRecommendedActions
 * @param {number} predictedLTV - Predicted LTV
 * @param {Object} insights - Customer insights
 * @param {Object} modelData - Model data
 * @returns {Array<Object>} Recommended actions
 */
function generateRecommendedActions(predictedLTV, insights, modelData) {
    const actions = [];
    
    // Based on value segment
    switch (insights.valueSegment) {
        case 'Premium':
            actions.push({
                action: 'VIP Program',
                description: 'Enroll customer in VIP loyalty program with special perks'
            });
            actions.push({
                action: 'Personalized Outreach',
                description: 'Schedule personal contact from customer success team'
            });
            break;
        case 'High':
            actions.push({
                action: 'Loyalty Program',
                description: 'Enroll customer in loyalty program with premium tier'
            });
            actions.push({
                action: 'Upsell Campaign',
                description: 'Target with premium product upsell campaigns'
            });
            break;
        case 'Medium':
            actions.push({
                action: 'Engagement Campaign',
                description: 'Increase purchase frequency with targeted engagement'
            });
            break;
        case 'Low':
        case 'Very Low':
            actions.push({
                action: 'Retention Campaign',
                description: 'Targeted campaign to increase engagement and prevent churn'
            });
            actions.push({
                action: 'Special Offer',
                description: 'Limited-time discount to encourage repeat purchase'
            });
            break;
    }
    
    // Based on risk factors
    for (const risk of insights.riskFactors) {
        if (risk.factor === 'High recency') {
            actions.push({
                action: 'Reactivation Campaign',
                description: 'Send special offer to encourage inactive customer to return'
            });
        } else if (risk.factor === 'Low purchase frequency') {
            actions.push({
                action: 'Second Purchase Incentive',
                description: 'Offer incentive specifically designed to secure second purchase'
            });
        }
    }
    
    // Based on growth opportunities
    for (const opportunity of insights.growthOpportunities) {
        if (opportunity.opportunity === 'Cross-selling') {
            actions.push({
                action: 'Cross-Sell Campaign',
                description: 'Recommend complementary products from other categories'
            });
        } else if (opportunity.opportunity === 'Loyal customer') {
            actions.push({
                action: 'Referral Program',
                description: 'Invite to customer referral program with rewards'
            });
        }
    }
    
    // Return unique actions (no duplicates)
    const uniqueActions = [];
    const actionTypes = new Set();
    
    for (const action of actions) {
        if (!actionTypes.has(action.action)) {
            uniqueActions.push(action);
            actionTypes.add(action.action);
        }
    }
    
    return uniqueActions.slice(0, 3); // Limit to top 3 actions
}

/**
 * Fetch customer data from database
 * 
 * @async
 * @function fetchCustomerData
 * @param {string} table - Database table
 * @param {number} customerId - Customer ID
 * @param {Object} connection - Database connection
 * @returns {Object|null} Customer data
 */
async function fetchCustomerData(table, customerId, connection) {
    try {
        // Get customer from main table
        const customer = await executeQuery(
            connection,
            `SELECT * FROM ${table} WHERE id = ?`,
            [customerId]
        );
        
        if (!customer || customer.length === 0) {
            return null;
        }
        
        // Try to get additional customer data from related tables if available
        try {
            // Try to get orders if orders table exists
            const orders = await executeQuery(
                connection,
                `SELECT * FROM orders WHERE customer_id = ? ORDER BY order_date DESC LIMIT 50`,
                [customerId]
            );
            
            if (orders && orders.length > 0) {
                // Enhance customer with order data
                customer[0].orders = orders;
                customer[0].order_count = orders.length;
                customer[0].last_order_date = orders[0].order_date;
                
                // Calculate average order value
                const totalOrderValue = orders.reduce(
                    (sum, order) => sum + (order.total || order.amount || 0), 
                    0
                );
                customer[0].average_order_value = totalOrderValue / orders.length;
            }
        } catch (error) {
            // Ignore errors with related tables - they might not exist
            consolelog.debug(`No orders table or error accessing it: ${error.message}`);
        }
        
        return customer[0];
    } catch (error) {
        consolelog.error(`Error fetching customer data for ${customerId}:`, error);
        return null;
    }
}

/**
 * Fetch LTV distribution from database
 * 
 * @async
 * @function fetchLTVDistribution
 * @param {string} table - Database table
 * @param {string} targetField - LTV field name
 * @param {Object} connection - Database connection
 * @returns {Array<Object>} LTV distribution data
 */
async function fetchLTVDistribution(table, targetField, connection) {
    try {
        // Calculate distribution percentiles
        const percentiles = await executeQuery(
            connection,
            `
            SELECT
                MIN(${targetField}) as min_ltv,
                MAX(${targetField}) as max_ltv,
                AVG(${targetField}) as avg_ltv,
                
                -- Approximate percentiles (may vary by database)
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${targetField}) as p25,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${targetField}) as p50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${targetField}) as p75,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ${targetField}) as p90,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${targetField}) as p95
            FROM ${table}
            WHERE ${targetField} IS NOT NULL
            `
        );
        
        if (!percentiles || percentiles.length === 0) {
            return [];
        }
        
        // Create range buckets
        const bucketCount = 10;
        const min = percentiles[0].min_ltv;
        const max = percentiles[0].max_ltv;
        const bucketSize = (max - min) / bucketCount;
        
        const distribution = [];
        for (let i = 0; i < bucketCount; i++) {
            const lowerBound = min + (i * bucketSize);
            const upperBound = min + ((i + 1) * bucketSize);
            
            // Count customers in this range
            const count = await executeCountQuery(
                connection,
                `
                SELECT COUNT(*) as count
                FROM ${table}
                WHERE ${targetField} >= ? AND ${targetField} < ?
                `,
                [lowerBound, upperBound]
            );
            
            distribution.push({
                range: `${lowerBound.toFixed(2)}-${upperBound.toFixed(2)}`,
                lowerBound,
                upperBound,
                count
            });
        }
        
        return {
            percentiles: percentiles[0],
            distribution
        };
    } catch (error) {
        consolelog.error(`Error fetching LTV distribution for ${table}:`, error);
        return [];
    }
}

// Helper import for one-hot encoding if needed
function oneHotEncode(value, existingCategories = []) {
    try {
        // Handle null/undefined values by returning zero vector
        if (value === null || value === undefined) {
            return {
                encoded: existingCategories.length > 0 ? Array(existingCategories.length).fill(0) : [0]
            };
        }

        // Convert value to string for consistent handling
        const stringValue = String(value);

        // Create encoded array
        const encoded = existingCategories.map(category => category === stringValue ? 1 : 0);

        return { encoded };
    } catch (error) {
        consolelog.error('Error in oneHotEncode function:', error);
        // Return zero vector on error
        return {
            encoded: existingCategories.length > 0 ? Array(existingCategories.length).fill(0) : [0]
        };
    }
}

module.exports = handler;