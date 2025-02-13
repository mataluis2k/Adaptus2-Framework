const admin = require('firebase-admin');
const logger = require('../modules/logger');
const { globalContext } = require('../modules/context'); // Import the shared globalContext and getContext
let isContextExtended = false; // Ensure extendContext is only called once
const { config} = require('dotenv');
const path = require('path');

config({ path: path.resolve(__dirname, '../../.env') });

class FirebaseService {
    constructor() {
        if (!admin.apps.length) {
            // Initialize Firebase Admin SDK
            console.log('Initializing Firebase Admin SDK');
            try {
                let serviceAccount;
                let serviceAccountPath;
                try {
                    // First try to get credentials from environment variable
                    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
                        serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
                    } else {
                        // Fall back to service account file
                        serviceAccountPath = path.join(process.env.CONFIG_DIR, 'firebaseService.json');
                                                                    
                    }
                    console.log('Service account path:', serviceAccountPath); 
                      // load the service account file
                    serviceAccount = require(serviceAccountPath);
                    console.log('Service account loaded from file:', serviceAccount );
                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount)
                    });
                    if (!isContextExtended) {
                        this.extendContext();
                        isContextExtended = true; // Prevent multiple extensions
                    }
                    logger.info('Firebase initialized successfully');
                    return admin;
                } catch (error) {
                    logger.warn('Firebase service account not configured. Firebase features will be disabled.', error);                    
                    return null; // Exit constructor without initializing Firebase
                }
               
            } catch (error) {
                logger.error('Firebase initialization error:', error);                
                throw new Error('Firebase initialization failed');
            }
        }
        return null;
    }

    /**
     * Creates a custom Firebase authentication token for a user
     * @param {string} uid - The user ID to create a token for
     * @param {Object} [additionalClaims] - Optional additional claims to include in the token
     * @returns {Promise<string>} A Firebase custom authentication token
     */
    async createCustomToken(uid, additionalClaims = {}) {
        console.log('Creating custom token for UID:', uid);
        try {
            if (!uid) {
                throw new Error('User ID is required');
            }

            // Check if Firebase is initialized
            if (!admin.apps.length) {
                logger.warn('Firebase not initialized. Skipping token creation.');
                return null;
            }

            const token = await admin.auth().createCustomToken(uid, additionalClaims);
            logger.info(`Created Firebase token for UID: ${uid}`);
            return token;
        } catch (error) {
            logger.error('Error creating Firebase custom token:', error);
            throw error;
        }
    }

    /**
     * Verifies a Firebase ID token
     * @param {string} idToken - The Firebase ID token to verify
     * @returns {Promise<Object>} The decoded token claims
     */
    async verifyIdToken(idToken) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            return decodedToken;
        } catch (error) {
            logger.error('Error verifying Firebase ID token:', error);
            throw error;
        }
    }

    extendContext() {
        globalContext.actions.firebaseToken = async (ctx, params) => {
            console.log('Creating custom token with params:', params);
            const { uuid, additionalClaims } = params.data;
            const token =  await this.createCustomToken(uuid, additionalClaims);
            console.log('Custom token created:', JSON.stringify(token));
            ctx.data['token'] = token;               
                
            return { success: true, result, key: 'token' };
        };
        globalContext.actions.firebaseVerify = async (ctx, params) => {
            const { idToken } = params;
            return await this.verifyIdToken(idToken);
        }
    }
}

module.exports = FirebaseService;
