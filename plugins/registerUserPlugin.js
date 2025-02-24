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
        this.response = customRequire('../src/modules/response');
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
            
        let firebase_user_token = "";

        try {
            await this.checkUserExists(ctx,dbConfig, email);
            const userId = await this.generateUniqueUUID(dbConfig);
            const hashedPassword = this.hashPassword(password);
            const status = "active";
            const created_at = moment().utc().format('YYYY-MM-DD HH:mm:ss');
            try {
                // Only attempt to create Firebase token if service is initialized
                const firebaseService = new this.FirebaseService();
                const firebaseToken = await firebaseService.createCustomToken(userId);
                if (firebaseToken) {
                    firebase_user_token = JSON.stringify(firebaseToken);                   
                }
            } catch (error) {
                const message = error.message || 'Failed to generate Firebase token';
                console.warn('Firebase token generation skipped:', message);
                ctx.data['error'] = message;            
                return { success: false, message, key: 'response' };
            }
            const userObject = {
                uuid: userId,
                email,
                password: hashedPassword, // Use a consistent key name
                name,
                gender,
                status,
                country_code,
                platform,
                firebase_token: firebase_user_token,
                acl,
                created_at
            };
            await this.createUserRecord(dbConfig, userObject);
            const object = this.apiConfig.getConfigNode('users_v2','def');
            console.log("AllowRead:", object.allowRead);
            const token = await this.genToken(userObject, object.allowRead, "password");
            // remove password from uerObject
            delete userObject.password;
            const response = {
                token,
                user: userObject
            };
            
            this.response.setResponse(200, "User created successfully", "", response, "registerUserPlugin");
            ctx.data['response'] = JSON.stringify(response);
            return { success: false, response, key: 'response' };
        } catch (error) {
            const message = error.message || 'Failed to create user';
            console.error("Error in createUser:", message);
            ctx.data['error'] = message;            
            return { success: false, message, key: 'response' };
        }
    },
    async checkUserExists(ctx, dbConfig, email) {
        const user = await dbFunctions.read(dbConfig, 'users_v2', { email });
        if (user.length > 0) {
            result = "User already registered!";
            ctx.data['response'] = result;
            return { success: false, result, key: 'response' };
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
    async updateUserToken(dbConfig, userId, token) {
        await dbFunctions.update(dbConfig, 'users_v2', { uuid : userId }, { firebase_token: token });
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
