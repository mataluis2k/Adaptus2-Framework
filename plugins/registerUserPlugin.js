const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const moment = require('moment');


// Module-level variables for dependencies
let dbFunctions = {};
let firebaseService;
let baseURL;


module.exports = {
    name: 'registerUserPlugin',
    version: '1.0.0',
    initialize(dependencies) {
        console.log('Initializing registerUserPlugin...');
        const { customRequire, context } = dependencies; // Access global context
        dbFunctions = customRequire('../src/modules/db');
        this.genToken = customRequire('../src/modules/genToken');
        this.apiConfig = customRequire('../src/modules/apiConfig');
        this.FirebaseService = customRequire('../src/services/firebaseService');
        baseURL = process.env.BASE_URL || 'http://localhost:3000';
        context.actions.registerUser = async (ctx, params) => {
            return await this.createUser(ctx, params.data);
        };
    },
    async createUser(ctx, params) {
        const { email, password, name, gender, country_code, platform, acl } = params;
        if (!email) throw new Error('Email is required');
        const dbConfig = ctx.config || process.env.DB_CONFIG;
        if (!dbConfig) throw new Error('Database configuration missing');
        try {
            await this.checkUserExists(dbConfig, email);
            const userId = await this.generateUniqueUUID(dbConfig);
            const hashedPassword = this.hashPassword(password);
            const status = "active";
            const created_at = moment().utc().format('YYYY-MM-DD HH:mm:ss');
            const userObject = {
                uuid: userId,
                email,
                password: hashedPassword, // Use a consistent key name
                name,
                gender,
                status,
                country_code,
                platform,
                acl,
                created_at
            };
            await this.createUserRecord(dbConfig, userObject);
            const object = this.apiConfig.getConfigNode('users_v2','def');
            console.log("AllowRead:", object.allowRead);
            const token = await this.genToken(userObject, object.allowRead, "password");
            
            let response = {
                token,
                uuid: userId,
                status,
                email,
                name,
                gender,
                created_at
            };

            try {
                // Only attempt to create Firebase token if service is initialized
                const firebaseService = new this.FirebaseService();
                const firebaseToken = await firebaseService.createCustomToken(userId);
                if (firebaseToken) {
                    response.firebase_user_token = firebaseToken;
                }
            } catch (error) {
                console.warn('Firebase token generation skipped:', error.message);
            }

            return response;
        } catch (error) {
            console.error("Error in createUser:", error.message);
            throw new Error(error.message);
        }
    },
    async checkUserExists(dbConfig, email) {
        const user = await dbFunctions.read(dbConfig, 'users_v2', { email });
        if (user.length > 0) {
            throw new Error('User already registered!');
        }
    },
    async generateUniqueUUID(dbConfig) {
        let userId, isUnique = false;
        while (!isUnique) {
            userId = uuidv4();
            const existingUser = await dbFunctions.read(dbConfig, 'users_v2', { id: userId });
            
            if (!existingUser || existingUser.length === 0) isUnique = true;
        }
        return userId;
    },
    hashPassword(password) {
        return bcrypt.hashSync(password, 10);
    },
    async createUserRecord(dbConfig, userData) {
        console.log("Creating user");
        await dbFunctions.create(dbConfig, 'users_v2', userData);
    },
    async authenticateUser(email, password) {
        try {
            const payload = { email, password };
            const object = this.apiConfig.getConfigNode('users_v2', 'def');
            const token = await this.genToken(payload, object.allowRead, "password");
            return token;
        } catch (error) {
            console.error("Authentication error:", error);
            throw new Error('Authentication failed');
        }
    },
};
