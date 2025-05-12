const { uuidv7 } = require('uuidv7');

const bcrypt = require('bcryptjs');
const moment = require('moment');


// Module-level variables for dependencies
let dbFunctions = {};
let firebaseService;
let baseURL;


module.exports = {
    name: 'loginPlugin',
    version: '1.0.0',
    initialize(dependencies) {
        console.log('Initializing loginPlugin...');
        const { customRequire, context } = dependencies; // Access global context
        dbFunctions = customRequire('../src/modules/db');
        this.genToken = customRequire('../src/modules/genToken');
        this.apiConfig = customRequire('../src/modules/apiConfig');
        this.response = customRequire('../src/modules/response');
;
        baseURL = process.env.BASE_URL || 'http://localhost:3000';
        context.actions.loginUser = async (ctx, params) => {
            return await this.loginUser(ctx, params.data);
        };
    },
    async loginUser(ctx, params) {
        const { email, password } = params;

        if (!email) throw new Error('Email is required');

        const dbConfig = ctx.config || process.env.DB_CONFIG;
        if (!dbConfig) throw new Error('Database configuration missing');
            

        try {
            const userFound = await this.checkUserExists(ctx,dbConfig, email);

            const user = userFound[0];
            const hashedPassword = this.hashPassword(password);
            const authenticated = bcrypt.compareSync(password, hashedPassword);
            
            if(!authenticated)
                return this.loginFailResponse();


            const is_logged_in = true;
            const updated_at = moment().utc().format('YYYY-MM-DD HH:mm:ss');
            const token = await this.authenticateUser(user, hashedPassword)

            if(token)
            {
                try{
                    response = {
                        "message": "Authentication successful",
                        "token": token,
                        "email": user.email,
                        "firebase_user_token": user.firebase_token,
                        "status": user.status,
                        "uuid": user.uuid,
                        "name": user.name,
                        "created_at": user.created_at
                    }
                    this.response.setResponse(200, "User authenticated successfully", "", response, "loginPlugin");
                    ctx.data['response'] = JSON.stringify(response);

                    const updateData = {
                        updated_at,
                        last_login_at: updated_at,
                        is_logged_in
                    }
                    await this.updateAuthenticatedUser(ctx, dbConfig, user.id, updateData);

                    return { success: true, response, key: 'response'};
                } catch(error) {
                    throw new Error("Error authenticating user.");
                    console.error("Error authenticating user:" + error.message);
                }
            }

            return this.loginFailResponse();
        } catch (error) {
            const message = error.message || 'Failed to authenticate user';
            console.error("Error in loginUser:", message);
            ctx.data['error'] = message;            
            return { success: false, message, key: 'response' };
        }
    },
    async checkUserExists(ctx, dbConfig, email) {
        const user = await dbFunctions.read(dbConfig, 'users_v2', { email });
        if (user.length == 0) {
            return this.loginFailResponse();
        }
        return user;
    },
    async updateAuthenticatedUser(ctx, dbConfig, id, data) {
        try {
        await dbFunctions.update(dbConfig, 'users_v2', {id}, data);
        return { success: true };
        } catch(error) {
            console.error(error.message);
            throw new Error(error.message);
        }
    },
    hashPassword(password) {
        return bcrypt.hashSync(password, 10);
    },
    async authenticateUser(user, password) {
        
        try {
            const {
                    id,
                    uuid,
                    email,
                    name,
                    gender,
                    status,
                    country_code,
                    platform,
                    firebase_token,
                    acl,
                    created_at
                } = user;

            const payload = {
                id,
                uuid,
                email,
                name,
                gender,
                status,
                country_code,
                platform,
                firebase_token,
                acl,
                created_at
            };
            const object = this.apiConfig.getConfigNode('users_v2', 'def');
            const token = await this.genToken(payload, object.allowRead, "password");
            return token;
        } catch (error) {
            console.error("Authentication error:", error);
            throw new Error('Authentication failed');
        }
    },
    loginFailResponse() {
        result = "Invalid email or password.";
        ctx.data['response'] = result;
        return { success: false, result, key: 'response' };
    }
};