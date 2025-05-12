const moment = require('moment');

// Module-level variables for dependencies
let dbFunctions = {};

module.exports = {
    name: 'submitQuestionPlugin',
    version: '1.0.0',
    initialize(dependencies) {
        console.log('Initializing submitQuestionPlugin...');
        const { customRequire, context } = dependencies; // Access global context
        dbFunctions = customRequire('../src/modules/db');
        this.response = customRequire('../src/modules/response');
        
        context.actions.submitQuestion = async (ctx, params) => {
            console.log("=======STARTING submitQuestionPlugin=======");
            console.log("ctx.data:", ctx.data);
            return await this.submitQuestion(ctx, params.data);
        };
    },
    async submitQuestion(ctx, params) {
        const { question } = params;
        const user_id = ctx.data.user ? ctx.data.user.id : null; // Get user_id from ctx.data.user

        if (!question) throw new Error('Question is required');
        if (!user_id) throw new Error('User ID is required');

        const dbConfig = ctx.config || process.env.DB_CONFIG;
        if (!dbConfig) throw new Error('Database configuration missing');

        try {
            const created_at = moment().utc().format('YYYY-MM-DD HH:mm:ss');
            const updated_at = created_at;

            const questionData = {
                question,
                user_id,
                created_at,
                updated_at
            };

            const result = await dbFunctions.create(dbConfig, 'question_submissions', questionData);

            if (result && result.insertId) {
                const response = {
                    id: result.insertId,
                    question,
                    created_at,
                    updated_at
                };
                this.response.setResponse(200, "Question submitted successfully", "", response, "submitQuestionPlugin");
                ctx.data['response'] = JSON.stringify(response);
                return { success: true, response, key: 'response' };
            }

            return this.submitFailResponse(ctx);
        } catch (error) {
            const message = error.message || 'Failed to submit question';
            console.error("Error in submitQuestion:", message);
            ctx.data['error'] = message;
            return { success: false, message, key: 'response' };
        }
    },
    submitFailResponse(ctx) {
        const result = "Failed to submit question.";
        ctx.data['response'] = result;
        return { success: false, result, key: 'response' };
    }
};