/**
 * Configuration Utilities
 * 
 * Utilities for managing ML configuration
 */

/**
 * Get default configuration for ML models
 * 
 * @returns {Object} - Default configuration
 */
function getDefaultConfig() {
    // System-wide defaults that apply if nothing is configured
    return {
        // Global training defaults
        batchSize: 1000,
        samplingRate: 1.0,
        parallelProcessing: false,
        incrementalTraining: false,

        // Sentiment analysis defaults
        sentimentConfig: {
            Language: 'English',
            textPreprocessing: true,
            minTextLength: 3,
            combineFields: false
        },

        // Recommendation system defaults
        recommendationConfig: {
            k: 3,
            scalingRange: [0, 1],
            minClusterSize: 2,
            missingValueStrategy: 'mean',
            weightedFields: {},
            similarityThreshold: 0.5
        },

        // Anomaly detection defaults
        anomalyConfig: {
            eps: 0.5,
            minPts: 2,
            scalingRange: [0, 1],
            missingValueStrategy: 'mean'
        },
        
        // Customer churn defaults
        churnConfig: {
            targetField: 'churned',
            featureFields: [],
            probabilityThreshold: 0.5,
            balancingStrategy: 'oversample',
            testSplit: 0.2,
            epochs: 10,
            earlyStoppingPatience: 3,
            featureImportance: true
        },
        
        // Customer segmentation defaults
        segmentationConfig: {
            numSegments: 5,
            segmentationFields: [],
            dimensionalityReduction: 'pca',
            scalingStrategy: 'standard',
            clusteringAlgorithm: 'kmeans',
            segmentNaming: true,
            visualizationEnabled: true
        },
        
        // Fraud detection defaults
        fraudDetectionConfig: {
            targetField: 'fraudulent',
            anomalyThreshold: 0.95,
            realTimeScoring: true,
            sensitivityLevel: 'medium',
            minimumSuspicionScore: 0.7,
            adaptiveLearning: true,
            featureAggregation: true
        },
        
        // Credit risk assessment defaults
        creditRiskConfig: {
            targetField: 'defaulted',
            scoreRange: [300, 850],
            riskCategories: ['low', 'medium', 'high', 'very_high'],
            requiredFields: [],
            weightedFactors: {},
            regulatoryCompliance: 'standard',
            explainabilityLevel: 'detailed'
        },
        
        // Demand forecasting defaults
        demandForecastingConfig: {
            targetField: 'demand',
            forecastHorizon: 90,
            seasonalityPeriods: [7, 30, 365],
            externalFactors: [],
            confidenceIntervals: true,
            aggregationLevel: 'daily',
            outlierTreatment: 'winsorize'
        },
        
        // Predictive maintenance defaults
        maintenanceConfig: {
            targetField: 'failure',
            equipmentIdField: 'equipment_id',
            leadTime: 14,
            sensorFields: [],
            failureTypes: [],
            minimumWarningConfidence: 0.8,
            maintenanceScheduleOptimization: true
        },
        
        // Employee churn defaults
        employeeChurnConfig: {
            targetField: 'left_company',
            employeeIdField: 'employee_id',
            performanceFields: [],
            engagementFields: [],
            compensationFields: [],
            timeHorizon: 180,
            confidenceThreshold: 0.65,
            retentionStrategies: true
        }
    };
}

/**
 * Validate configuration object against schema
 * 
 * @param {Object} config - Configuration to validate
 * @param {Object} schema - Schema for validation
 * @returns {Object} - Validation result with errors
 */
function validateConfig(config, schema) {
    const errors = [];
    const validConfig = { ...config };
    
    // Helper to check if value is of expected type
    function checkType(path, value, expectedType) {
        let valid = true;
        let actualType = typeof value;
        
        if (expectedType === 'array') {
            valid = Array.isArray(value);
            actualType = Array.isArray(value) ? 'array' : actualType;
        } else if (expectedType === 'number') {
            valid = typeof value === 'number' && !isNaN(value);
        } else if (expectedType === 'boolean') {
            valid = typeof value === 'boolean';
        } else if (expectedType === 'string') {
            valid = typeof value === 'string';
        } else if (expectedType === 'object') {
            valid = typeof value === 'object' && value !== null && !Array.isArray(value);
        }
        
        if (!valid) {
            errors.push(`${path} should be ${expectedType}, but got ${actualType}`);
        }
        
        return valid;
    }
    
    // Validate each field in the schema
    function validateField(configObj, schemaObj, path = '') {
        if (!schemaObj || typeof schemaObj !== 'object') return;
        
        // Check each schema field
        Object.entries(schemaObj).forEach(([key, fieldSchema]) => {
            const fieldPath = path ? `${path}.${key}` : key;
            const hasValue = configObj && Object.prototype.hasOwnProperty.call(configObj, key);
            const value = hasValue ? configObj[key] : undefined;
            
            // Check required fields
            if (fieldSchema.required && !hasValue) {
                errors.push(`Missing required field: ${fieldPath}`);
                return;
            }
            
            // Skip validation if value is undefined/null and not required
            if ((value === undefined || value === null) && !fieldSchema.required) {
                // Use default value if provided
                if (fieldSchema.default !== undefined && configObj) {
                    configObj[key] = fieldSchema.default;
                }
                return;
            }
            
            // Validate by type
            if (fieldSchema.type) {
                const validType = checkType(fieldPath, value, fieldSchema.type);
                
                // If valid type and object/array type, validate nested schema
                if (validType && fieldSchema.type === 'object' && fieldSchema.properties) {
                    validateField(value, fieldSchema.properties, fieldPath);
                }
                
                // If valid type and array type with items schema, validate each item
                if (validType && fieldSchema.type === 'array' && fieldSchema.items && Array.isArray(value)) {
                    value.forEach((item, i) => {
                        if (typeof fieldSchema.items === 'object') {
                            validateField(item, fieldSchema.items, `${fieldPath}[${i}]`);
                        } else {
                            checkType(`${fieldPath}[${i}]`, item, fieldSchema.items);
                        }
                    });
                }
            }
            
            // Validate enum values
            if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
                errors.push(`${fieldPath} must be one of: ${fieldSchema.enum.join(', ')}`);
            }
            
            // Validate min/max for numbers
            if (fieldSchema.type === 'number') {
                if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
                    errors.push(`${fieldPath} must be >= ${fieldSchema.minimum}`);
                }
                if (fieldSchema.maximum !== undefined && value > fieldSchema.maximum) {
                    errors.push(`${fieldPath} must be <= ${fieldSchema.maximum}`);
                }
            }
            
            // Validate minLength/maxLength for strings
            if (fieldSchema.type === 'string') {
                if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
                    errors.push(`${fieldPath} must have length >= ${fieldSchema.minLength}`);
                }
                if (fieldSchema.maxLength !== undefined && value.length > fieldSchema.maxLength) {
                    errors.push(`${fieldPath} must have length <= ${fieldSchema.maxLength}`);
                }
            }
            
            // Validate minItems/maxItems for arrays
            if (fieldSchema.type === 'array') {
                if (fieldSchema.minItems !== undefined && value.length < fieldSchema.minItems) {
                    errors.push(`${fieldPath} must have >= ${fieldSchema.minItems} items`);
                }
                if (fieldSchema.maxItems !== undefined && value.length > fieldSchema.maxItems) {
                    errors.push(`${fieldPath} must have <= ${fieldSchema.maxItems} items`);
                }
            }
            
            // Custom validation function
            if (fieldSchema.validate && typeof fieldSchema.validate === 'function') {
                try {
                    const validationResult = fieldSchema.validate(value);
                    if (validationResult !== true) {
                        errors.push(`${fieldPath}: ${validationResult}`);
                    }
                } catch (error) {
                    errors.push(`${fieldPath}: validation failed - ${error.message}`);
                }
            }
        });
    }
    
    // Start validation
    validateField(validConfig, schema);
    
    return {
        valid: errors.length === 0,
        errors,
        validatedConfig: validConfig
    };
}

/**
 * Merge configuration objects with defaults
 * 
 * @param {Object} base - Base configuration
 * @param {Object} override - Override configuration
 * @returns {Object} - Merged configuration
 */
function mergeConfig(base, override) {
    if (!override) return { ...base };
    if (!base) return { ...override };
    
    const result = { ...base };
    
    for (const [key, value] of Object.entries(override)) {
        // If the value is an object and not null, recursively merge
        if (value && typeof value === 'object' && !Array.isArray(value) && 
            result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = mergeConfig(result[key], value);
        } else {
            // Otherwise, override the value
            result[key] = value;
        }
    }
    
    return result;
}

/**
 * Get model configuration schema
 * 
 * @param {string} modelType - Type of model
 * @returns {Object|null} - Configuration schema for the model type
 */
function getConfigSchema(modelType) {
    const schemas = {
        sentiment: {
            language: { type: 'string', required: true, default: 'English' },
            textPreprocessing: { type: 'boolean', required: false, default: true },
            minTextLength: { type: 'number', required: false, default: 3 },
            combineFields: { type: 'boolean', required: false, default: false }
        },
        
        churn: {
            targetField: { type: 'string', required: true, default: 'churned' },
            featureFields: { type: 'array', required: false, default: [] },
            probabilityThreshold: { 
                type: 'number', 
                required: false, 
                default: 0.5,
                minimum: 0,
                maximum: 1
            },
            balancingStrategy: { 
                type: 'string', 
                required: false, 
                default: 'oversample',
                enum: ['none', 'oversample', 'undersample', 'weighted']
            },
            testSplit: { 
                type: 'number', 
                required: false, 
                default: 0.2,
                minimum: 0.1,
                maximum: 0.5
            },
            epochs: { 
                type: 'number', 
                required: false, 
                default: 10,
                minimum: 1
            },
            earlyStoppingPatience: { 
                type: 'number', 
                required: false, 
                default: 3,
                minimum: 0
            },
            featureImportance: { type: 'boolean', required: false, default: true }
        },
        
        // Add schemas for other model types as needed
    };
    
    return schemas[modelType] || null;
}

module.exports = {
    getDefaultConfig,
    validateConfig,
    mergeConfig,
    getConfigSchema
};