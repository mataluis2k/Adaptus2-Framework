const admin = require('firebase-admin');
const logger = require('../modules/logger');
const { globalContext } = require('../modules/context'); // Import the shared globalContext and getContext
let isContextExtended = false; // Ensure extendContext is only called once

class FirebaseService {
    constructor() {
        if (!admin.apps.length) {
            try {
                // Initialize Firebase Admin with default credentials
                // Note: Make sure to set GOOGLE_APPLICATION_CREDENTIALS environment variable
                admin.initializeApp({
                    credential: admin.credential.applicationDefault()
                });
                if (!isContextExtended) {
                    extendContext();
                    isContextExtended = true; // Prevent multiple extensions
                }
            } catch (error) {
                logger.error('Firebase initialization error:', error);
                throw new Error('Firebase initialization failed');
            }
        }
    }

    /**
     * Creates a custom Firebase authentication token for a user
     * @param {string} uid - The user ID to create a token for
     * @param {Object} [additionalClaims] - Optional additional claims to include in the token
     * @returns {Promise<string>} A Firebase custom authentication token
     */
    static async createCustomToken(uid, additionalClaims = {}) {
        try {
            if (!uid) {
                throw new Error('User ID is required');
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
    static async verifyIdToken(idToken) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            return decodedToken;
        } catch (error) {
            logger.error('Error verifying Firebase ID token:', error);
            throw error;
        }
    }

    extendContext(){
        globalContext.actions.firebaseToken = async (ctx, params) => {
            const { uuid, additionalClaims } = params;
            return await createCustomToken(uid, additionalClaims);
        };
        globalContext.actions.firebaseVerify = async (ctx, params) => {
            const { idToken } = params;
            return await verifyIdToken(idToken);
        }
    }
}

module.exports = FirebaseService;
