const crypto = require('crypto');
const { getDbConnection, create } = require('../src/modules/db');

module.exports = {
    name: 'passwordResetLinkBuilder',
    version: '1.0.0',

    initialize(dependencies) {
        const { context } = dependencies;
        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for passwordResetLinkBuilder.');
        }

        async function generateResetLink(ctx, params) {
            if (!params || !params.user_id || !params.email || !params.domain) {
                throw new Error('Missing required parameters: user_id, email, and domain.');
            }

            const resetToken = crypto.randomBytes(32).toString('hex');
            const hash = crypto.createHash('sha256').update(resetToken).digest('hex');
            const resetLink = `${params.domain}/reset-password?token=${hash}`;
            const expirationTime = new Date(Date.now() + 3600000); // Expires in 1 hour
            const createdAt = new Date();

            const dbConfig = ctx.config.db || process.env.DB_CONFIG;
            if (!dbConfig) {
                throw new Error('Database configuration is missing.');
            }

            const resetEntry = {
                user_id: params.user_id,
                resetlink: resetLink,
                email: params.email,
                expiration_datetime: expirationTime,
                created_at: createdAt,
                updated_at: createdAt
            };

            try {
                const dbConnection = await getDbConnection(dbConfig);
                await create(dbConnection, 'password_resets', resetEntry);
                console.log('Password reset link created successfully.');
                return { resetLink };
            } catch (error) {
                console.error('Error generating reset link:', error.message);
                throw new Error('Failed to generate reset link.');
            }
        }

        if (!context.actions.generateResetLink) {
            context.actions.generateResetLink = generateResetLink;
        }

        console.log('passwordResetLinkBuilder action registered in global context.');
    },
};