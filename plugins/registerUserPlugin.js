const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const moment = require('moment');
const express = require('express'); // Import express
// validationMiddleware.js
const Joi = require('joi');

// Module-level variables for dependencies
let dbFunctions = {};
let firebaseService;
let baseURL;


module.exports = {
    name: 'registerUserPlugin',
    version: '1.0.0',
    initialize(dependencies) {
        console.log('Initializing registerUserPlugin...');
        const { customRequire, context, app } = dependencies; // Access global context and app
        dbFunctions = customRequire('../src/modules/db');
        this.genToken = customRequire('../src/modules/genToken');
        this.response = customRequire('../src/modules/response');
        this.apiConfig = customRequire('../src/modules/apiConfig');
        this.FirebaseService = customRequire('../src/services/firebaseService');
        this.validationMapping = customRequire('../src/middleware/validationMapping');
        baseURL = process.env.BASE_URL || 'http://localhost:3000';
        context.actions.registerUser = async (ctx, params) => {
            return await this.createUser(ctx, params.data);
        };

        // Add route for registration
        app.use(express.json()); // Make sure you have the json body parser set up!

        // Define validation rules
        const validationRules = {
            email: { type: 'string', notEmpty: true, isValidEmail: true, errorCodes: { httpCode: 400, code: [2001] } },
            password: { type: 'string', notEmpty: true, minLength: 8, regex: "^(?=.*[A-Za-z]).{8,}$", errorCodes: { httpCode: 400, code: [2003] } },
            name: { type: 'string', notEmpty: true, errorCodes: { httpCode: 400, code: [2001] } },
            gender: { type: 'string', gender: true, errorCodes: { httpCode: 400, code: [2001] , message: "Gender must be one of: male, female, nonbinary."} },
            country_code: { type: 'string', countryCode: true, errorCodes: { httpCode: 400, code: [2001] } },
            platform: { type: 'string', platform: true, errorCodes: { httpCode: 400, code: [2001], message: "Platform must be one of: ios, android, web." } },
            timezone: { type: 'string', timezone: true, errorCodes: { httpCode: 400, code: [2001] } },
        };

        const vm = this.validationMapping;
        function generateValidationSchema(rules) {
                const schemaObj = {};
                Object.entries(rules).forEach(([field, ruleSet]) => {
                    let fieldSchema = Joi.any();
                    if (ruleSet.type) {
                    fieldSchema = vm.type(Joi.any(), ruleSet.type);
                    }
                    // Apply all other rules (skip type and errorCodes)
                    for (const rule in ruleSet) {
                    if (rule === 'type' || rule === 'errorCodes') continue;
                    if (vm[rule]) {
                        fieldSchema = vm[rule](fieldSchema, ruleSet[rule], field);
                    }
                    }
                    schemaObj[field] = fieldSchema;
                });
                return Joi.object(schemaObj);
        }
        // Use the validation middleware for the /api/register route
        app.post('/api/register',  async (req, res) => {
            try {
                
                // Generate schema using centralized validationMapping rules
                const registerSchema = generateValidationSchema(validationRules);
                const { error, value } = registerSchema.validate(req.body, {
                abortEarly: false
                });
                if (error) {
                return res.status(400).json({ errors: error.details });
                }

                const ctx = {
                    config: {
                        dbType: process.env.DEFAULT_DBTYPE,
                        dbConnection: process.env.DEFAULT_DBCONNECTION
                    },
                    data: {}
                };

                const params = {
                    data: value
                };

                const result = await this.createUser(ctx, params.data);

                if (result.key === 'response') {
                    res.status(200).json(JSON.parse(ctx.data['response']));
                } else {
                    res.status(500).json({ error: ctx.data['error'] || "Registration failed" });
                }
            } catch (error) {
                console.error('Error in /api/register route:', error);
                res.status(500).json({ error: error.message || 'Registration failed' });
            }
        });

    },
    async createUser(ctx, params) {
        try {
            const { email, password, name, gender, country_code, platform, acl, timezone } = params;
            console.log("Params===================================>", params);
            if (!email) throw new Error('Email is required');
            const dbConfig = ctx.config ;
            if (!dbConfig) throw new Error('Database configuration missing');

            let firebase_user_token = "";

            await this.checkUserExists(ctx, dbConfig, email);
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
                timezone,
                created_at
            };
            await this.createUserRecord(dbConfig, userObject);
            const object = this.apiConfig.getConfigNode('users_v2', 'def');
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
            return { success: true, response, key: 'response' };
        } catch (error) {
            const message = error.message || 'Failed to create user';
            console.error("Error in createUser:", message);
            ctx.data['error'] = message;
            return { success: false, message, key: 'error' };
        }
    },
    async checkUserExists(ctx, dbConfig, email) {
        try {
            const user = await dbFunctions.read(dbConfig, 'users_v2', { email });
            if (user.length > 0) {
                result = "User already registered!";
                ctx.data['response'] = result;
                return { success: false, result, key: 'response' };
            }
        } catch (error) {
            const message = error.message || 'Failed to check if user exists';
            console.error("Error in checkUserExists:", message);
            throw new Error(message); // Re-throw to bubble up
        }
    },
    async generateUniqueUUID(dbConfig) {
        try {
            let userId, isUnique = false;
            while (!isUnique) {
                userId = uuidv4();
                const existingUser = await dbFunctions.read(dbConfig, 'users_v2', { id: userId });

                if (!existingUser || existingUser.length === 0) isUnique = true;
            }
            return userId;
        } catch (error) {
            const message = error.message || 'Failed to generate unique UUID';
            console.error("Error in generateUniqueUUID:", message);
            throw new Error(message); // Re-throw to bubble up
        }
    },
    hashPassword(password) {
        try {
            return bcrypt.hashSync(password, 10);
        } catch (error) {
            const message = error.message || 'Failed to hash password';
            console.error("Error in hashPassword:", message);
            throw new Error(message); // Re-throw to bubble up
        }
    },
    async createUserRecord(dbConfig, userData) {
        try {
            console.log("Creating user");
            await dbFunctions.create(dbConfig, 'users_v2', userData);
        } catch (error) {
            const message = error.message || 'Failed to create user record';
            console.error("Error in createUserRecord:", message);
            throw new Error(message); // Re-throw to bubble up
        }
    },
    async updateUserToken(dbConfig, userId, token) {
        try {
            await dbFunctions.update(dbConfig, 'users_v2', { uuid: userId }, { firebase_token: token });
        } catch (error) {
            const message = error.message || 'Failed to update user token';
            console.error("Error in updateUserToken:", message);
            throw new Error(message); // Re-throw to bubble up
        }
    },
    async authenticateUser(email, password) {
        try {
            const payload = { email, password };
            const object = this.apiConfig.getConfigNode('users_v2', 'def');
            const token = await this.genToken(payload, object.allowRead, "password");
            return token;
        } catch (error) {
            console.error("Authentication error:", error);
            throw new Error(error.message || 'Authentication failed'); // Re-throw to bubble up
        }
    },
};
