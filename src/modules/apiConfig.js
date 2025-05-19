const fs = require('fs');
const consolelog = require('./logger');
const { exit } = require('process');
const path = require('path');
const CMS_TABLE_SCHEMA = require('./cmsDefinition');
const ECOMMTRACKER_TABLE_SCHEMAS = require('./EcommDefinitions');
require('dotenv').config({ path: __dirname + '/.env' });
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
const configPath = path.join(configDir, 'apiConfig.json');
var categorizedConfig = null;
var apiConfig = null;
const { globalContext } = require('./context');
console.log('Building API configuration from database...');

const { broadcastConfigUpdate } = require('./configSync');

// Declare internal apiConfig and write a getter function to be exported
// This way, the apiConfig can be accessed from outside this module
// but not modified.
var internalApiConfig = [];

function getMyConfig(fileName) {
    try {
        const configPath = path.join(configDir, fileName);
        console.log('Loading custom config from:', configPath);
        if (!fs.existsSync(configPath)) {
            console.warn(`File not found: ${configPath}. Returning default.`);
            return {};
        }
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        if (!fileContent.trim()) {
            console.warn(`File is empty: ${configPath}. Returning default.`);
            return {};
        }
        return JSON.parse(fileContent);
    } catch (error) {
        console.error('Failed to load custom config:', error.message);
        return {};
    }
}

function getApiConfig() {
    // test if null or undefined or empty array and call loadConfig before returning
    if (!apiConfig || apiConfig.length === 0) {
        if (typeof loadConfig === 'function') {
            loadConfig();
        } else {
            console.warn('loadConfig function not available, returning empty config');
            return [];
        }
    }
    return internalApiConfig || [];
}

function getConfigNode(table,routeType){ 
    const apiConfig = getApiConfig();
    return apiConfig.find(item => 
      item.routeType === routeType &&
      item.dbTable === table
    );
}

/**
 * Scans a directory for JSON files and returns their parsed contents
 * @param {string} directoryPath - Path to the directory to scan
 * @returns {Array} - Array of valid configuration objects from JSON files
 */
function loadExtraConfigs(directoryPath) {
  const extraConfigs = [];
  console.log(`Checking for extra configs in: ${directoryPath}`);
  
  if (!fs.existsSync(directoryPath)) {
    console.log(`Extra configs directory not found: ${directoryPath}. Continuing with main config only.`);
    return extraConfigs; // Return empty array, which won't affect the main config
  }
  
  try {
    const files = fs.readdirSync(directoryPath);
    
    if (files.length === 0) {
      console.log(`No files found in extra configs directory. Continuing with main config only.`);
      return extraConfigs;
    }
    
    console.log(`Found ${files.length} files in extra configs directory, processing...`);
    
    // Rest of the code remains the same...
    // ...
  } catch (error) {
    console.error(`Error scanning extra configs directory: ${error.message}. Continuing with main config only.`);
    return extraConfigs; // Return empty array on any error to continue with main config
  }
  
  return extraConfigs;
}
/**
 * Loads custom route types from the `apiTypes.conf` configuration file.
 * @returns {Object} - An object mapping custom route types to their actions.
 */
function loadCustomTypes(configDir) {
    try {
        const configPath = path.join(configDir, 'apiTypes.json');
        console.log('Loading custom types from:', configPath);

        if (!fs.existsSync(configPath)) {
            console.warn(`File not found: ${configPath}. Creating default file.`);
            const defaultContent = JSON.stringify([
                { routeType: "defaultType", action: "defaultAction" }
            ], null, 2);
            fs.writeFileSync(configPath, defaultContent, 'utf-8');
            return JSON.parse(defaultContent);
        }

        const fileContent = fs.readFileSync(configPath, 'utf-8');
        if (!fileContent.trim()) {
            console.warn(`File is empty: ${configPath}. Creating default content.`);
            const defaultContent = JSON.stringify([
                { routeType: "defaultType", action: "defaultAction" }
            ], null, 2);
            fs.writeFileSync(configPath, defaultContent, 'utf-8');
            return JSON.parse(defaultContent);
        }

        const customTypes = JSON.parse(fileContent);
        if (!Array.isArray(customTypes)) {
            console.warn(`Invalid JSON format in ${configPath}. Expecting an array. Returning default.`);
            return {};
        }

        return customTypes.reduce((acc, { routeType, action }) => {
            if (routeType && action) {
                acc[routeType] = action;
            } else {
                console.warn(`Invalid entry: ${JSON.stringify({ routeType, action })}`);
            }
            return acc;
        }, {});

    } catch (error) {
        console.error('Failed to load custom types:', error.message);
        return {};
    }
}

function categorizeApiConfig(apiConfig) {
    // Predefined route categories
    const categorized = {
        databaseRoutes: [],
        dynamicRoutes: [],
        proxyRoutes: [],
        fileUploadRoutes: [],
        cronJobs: [],
        standardRoutes: [],
        unknownRoutes: [],
        definitionRoutes: [],
        staticRoutes: [],
    };
    
    try{
            
            console.log('Categorizing API configuration...');
            // // Load custom route types from configuration
            const customTypes = loadCustomTypes(configDir);
            consolelog.log('Custom route types:');
            // Initialize custom route categories
              // Correct check: Check if the object has any keys
            for (const type in customTypes) { // Iterate only if customTypes is not empty
                categorized[`${type}Routes`] = [];
            }
            consolelog.log('Custom route categories:', apiConfig);
            // Categorize routes
            apiConfig.forEach((endpoint) => {
                const { routeType } = endpoint;

                if (categorized[`${routeType}Routes`]) {
                    categorized[`${routeType}Routes`].push(endpoint);
                } else {
                    switch (routeType) {
                        case 'database':
                            categorized.databaseRoutes.push(endpoint);
                            break;
                        case 'dynamic':
                            categorized.dynamicRoutes.push(endpoint);
                            break;
                        case 'proxy':
                            categorized.proxyRoutes.push(endpoint);
                            break;
                        case 'fileUpload':
                            categorized.fileUploadRoutes.push(endpoint);
                            break;
                        case 'cron':
                            categorized.cronJobs.push(endpoint);
                            break;
                        case 'def':
                            categorized.definitionRoutes.push(endpoint);
                            break;
                        case 'static':
                                categorized.staticRoutes.push(endpoint);
                                break;
                        default:
                            categorized.unknownRoutes.push(endpoint);
                    }
                }
            });
            consolelog.log('Categorized API configuration:', categorized);  
        
            return categorized;
    } catch (error) {
        console.error('Error categorizing API configuration:', error);
        exit(1);
    }
}

/**
 * Categorizes API configurations into predefined and custom route types.
 * @param {Array} apiConfig - Array of API endpoint configurations.
 * @returns {Object} - Categorized routes by type.
 */
const loadConfig = async (configFile = configPath) => {
    try {
        consolelog.log('Loading configuration...', configFile);
        const configData = fs.readFileSync(configFile, 'utf-8');
        apiConfig = JSON.parse(configData);
        
        const extrasConfigDir = path.join(configDir, 'extras_config');
        let extraConfigs = [];
        try {
            extraConfigs = loadExtraConfigs(extrasConfigDir);
        } catch (error) {
            // Catch any unexpected errors to ensure main config processing continues
            console.error(`Failed to load extra configs: ${error.message}. Continuing with main config only.`);
        }

        // Merge extra configs with main config (only if there are any)
        if (extraConfigs && extraConfigs.length > 0) {
            console.log(`Merging ${extraConfigs.length} extra configurations into main config.`);
            apiConfig = [...apiConfig, ...extraConfigs];
        } else {
            console.log('No extra configurations to merge. Proceeding with main config only.');
        }
        
        // Add CMS_TABLE_SCHEMA to apiConfig
        if (!apiConfig.find(config => config.dbTable === CMS_TABLE_SCHEMA.dbTable && config.routeType === CMS_TABLE_SCHEMA.routeType)) {
            apiConfig.push(CMS_TABLE_SCHEMA);
        }
        
        // Add ECOMMTRACKER_TABLE_SCHEMAS to apiConfig
        // ECOMMTRACKER_TABLE_SCHEMAS contains multiple table definitions
        Object.keys(ECOMMTRACKER_TABLE_SCHEMAS).forEach(table => {
            const schema = ECOMMTRACKER_TABLE_SCHEMAS[table];
            if (!apiConfig.find(config => config.dbTable === schema.dbTable && config.routeType === CMS_TABLE_SCHEMA.routeType)) {
                apiConfig.push(schema);
            }
        });
       
        categorizedConfig = categorizeApiConfig(apiConfig);

        // Update global context resources
        registerResources(apiConfig, globalContext);

        // Broadcast updates in network mode
        if (process.env.PLUGIN_MANAGER === 'network') {
            await broadcastConfigUpdate(apiConfig, categorizedConfig, globalContext);
        }

        consolelog.log('Configuration loaded successfully.');
        internalApiConfig = apiConfig;
        return apiConfig;
    } catch (error) {
        console.error('Error loading configuration:', error);
        throw error;
    }
};


/**
 * For each endpoint in apiConfig, 
 * parse the route and register the last part as a resource.
 */
function registerResources(apiConfig, globalContext) {
    consolelog.log(globalContext);
    
    if (!globalContext.resources) {
      globalContext.resources = {};
    }
  
    apiConfig.forEach((endpoint) => {
      // e.g. endpoint.route might be "/api/articles"
      // or "/myservice/products", etc.
      const { route } = endpoint;
      if (typeof route !== 'string') {
        // If there's no 'route' or it's not a string, skip
        return;
      }

        // Register the full route explicitly as a resource
        const resourceKey = route.toLowerCase().trim();

        if (!globalContext.resources[resourceKey]) {
            consolelog.log(`Registering resource: '${resourceKey}' in globalContext.resources`);
            globalContext.resources[resourceKey] = {};
        }
  
      // Grab the last part after splitting by '/'
      const parts = route.split('/');
      const lastSegment = parts[parts.length - 1].trim();
  
      // Basic validation
      if (!lastSegment) return;
  
      // Add a resource record to globalContext
      // If it doesn't exist, create an empty object
      if (!globalContext.resources[lastSegment]) {
        consolelog.log(`Registering resource: '${lastSegment}' in globalContext.resources`);
        globalContext.resources[lastSegment] = {};
      }
    });
}

module.exports = { loadConfig, getApiConfig, categorizedConfig , categorizeApiConfig, getConfigNode, getMyConfig};
