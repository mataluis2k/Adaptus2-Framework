// configSync.js
const Redis = require('ioredis');

const publisherRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379'); // For publishing and general commands
const subscriberRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379'); // For subscribing
const CLUSTER_NAME = process.env.CLUSTER_NAME || 'default';
const CONFIG_UPDATE_CHANNEL = `${CLUSTER_NAME}:config:update`;
const CONFIG_STORAGE_KEY = `${CLUSTER_NAME}:config:data`;

const { v4: uuidv4 } = require('uuid'); // Use UUID for server instance identification

const serverId = uuidv4(); // Unique identifier for this server

async function broadcastConfigUpdate(apiConfig, categorizedConfig, globalContext) {
    try {
        const currentTimestamp = Date.now(); // Use a timestamp as the version
        const configData = {
            apiConfig,
            categorizedConfig,
            globalContext,
            version: currentTimestamp, // Add version
            serverId: process.env.SERVER_ID || 'unknown', // Include server ID for debugging
        };
        // Use a custom replacer to remove the circular reference.
        const safeConfigData = JSON.stringify(configData, (key, value) => {
            // Omit the ruleEngine property anywhere in the structure.
            if (key === 'ruleEngine') {
                return undefined;
            }
            return value;
        });

        // Store configuration in Redis
        await publisherRedis.set(CONFIG_STORAGE_KEY, safeConfigData);

        // Publish update notification
        await publisherRedis.publish(CONFIG_UPDATE_CHANNEL, JSON.stringify({ action: 'update', version: currentTimestamp }));

        console.log(`Configuration broadcasted successfully. Version: ${currentTimestamp}`);
    } catch (error) {
        console.error('Error broadcasting configuration:', error.message);
    }
}

async function subscribeToConfigUpdates(onUpdateCallback) {
    let localVersion = 0; // Placeholder

    // Fetch the latest version from Redis on startup
    try {
        const configData = JSON.parse(await publisherRedis.get(CONFIG_STORAGE_KEY));
        if (configData && configData.version) {
            localVersion = configData.version;
            console.log(`Initialized local config version to ${localVersion}`);
        }
    } catch (error) {
        console.error('Error initializing local config version from Redis:', error.message);
    }

    subscriberRedis.subscribe(CONFIG_UPDATE_CHANNEL, (err) => {
        if (err) {
            console.error('Failed to subscribe to config updates:', err.message);
        } else {
            console.log(`Subscribed to config updates for cluster "${CLUSTER_NAME}".`);
        }
    });

    subscriberRedis.on('message', async (channel, message) => {
        if (channel === CONFIG_UPDATE_CHANNEL) {
            try {
                const { action, version } = JSON.parse(message);

                // Avoid redundant updates if the version is the same
                if (action === 'update' && version > localVersion) {
                    const configData = JSON.parse(await publisherRedis.get(CONFIG_STORAGE_KEY));
                    if (configData && configData.version > localVersion) {
                        const sourceServerId = configData.serverId || 'unknown'; // Extract serverId
                        localVersion = configData.version; // Update local version
                        onUpdateCallback(configData, sourceServerId); // Pass serverId
                        console.log(`Configuration updated to version ${configData.version} from server ${sourceServerId}.`);
                    }
                } else {
                    console.log(`Ignoring duplicate or older config update (version ${version}), local version is ${localVersion}`);
                }
            } catch (error) {
                console.error('Error handling config update:', error.message);
            }
        }
    });
}




module.exports = { broadcastConfigUpdate, subscribeToConfigUpdates };
