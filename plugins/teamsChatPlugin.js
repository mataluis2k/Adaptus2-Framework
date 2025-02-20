const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

module.exports = {
    name: 'teamsChatPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for teamsChatPlugin.');
        }

        const teamsAppId = process.env.TEAMS_APP_ID;
        const teamsAppSecret = process.env.TEAMS_APP_SECRET;
        const chatServerEndpoint = process.env.CHAT_SERVER_ENDPOINT;
        const teamsWebhookUrl = process.env.TEAMS_WEBHOOK_URL;
        const teamsSubscriptionUrl = 'https://graph.microsoft.com/v1.0/subscriptions';
        
        if (!teamsAppId || !teamsAppSecret || !chatServerEndpoint || !teamsWebhookUrl) {
            throw new Error('Missing required Teams configurations. Ensure TEAMS_APP_ID, TEAMS_APP_SECRET, CHAT_SERVER_ENDPOINT, and TEAMS_WEBHOOK_URL are set.');
        }

        const teamsApiClient = new UniversalApiClient({
            baseUrl: 'https://graph.microsoft.com/v1.0',
            authType: 'token',
            authValue: `${teamsAppId}:${teamsAppSecret}`,
        });

        const app = express();
        app.use(bodyParser.json());

        async function createChatGPTChannel() {
            const channelData = {
                displayName: "ChatGPT AI Help",
                description: "A dedicated AI assistant channel for team inquiries.",
                isFavoriteByDefault: true
            };

            try {
                const response = await teamsApiClient.post(`/teams/{team-id}/channels`, channelData);
                console.log('Successfully created ChatGPT AI Help channel:', response);
            } catch (error) {
                console.error('Error creating ChatGPT AI Help channel:', error.message);
            }
        }

        app.post('/teams/events', async (req, res) => {
            const { type, value } = req.body;

            if (type === 'message' && value && value.from && value.text) {
                const message = value.text.trim();
                const isAiQuery = message.toLowerCase().startsWith('/ai');
                let responseText = '';

                if (isAiQuery) {
                    const aiPrompt = message.slice(3).trim();
                    const aiResponse = await context.actions.processAIMessage(null, { message: aiPrompt });
                    responseText = aiResponse.text;
                } else {
                    responseText = `Echo: ${message}`;
                }

                await teamsApiClient.post(teamsWebhookUrl, {
                    text: responseText,
                });
            }

            res.status(200).send();
        });

        async function subscribeToTeamsMessages() {
            const subscriptionData = {
                changeType: 'created',
                notificationUrl: `${chatServerEndpoint}/teams/events`,
                resource: '/chats/getAllMessages',
                expirationDateTime: new Date(Date.now() + 3600 * 1000 * 24).toISOString(),
                clientState: crypto.randomBytes(16).toString('hex'),
            };

            try {
                const response = await teamsApiClient.post(teamsSubscriptionUrl, subscriptionData);
                console.log('Successfully subscribed to Teams messages:', response);
            } catch (error) {
                console.error('Error subscribing to Teams messages:', error.message);
            }
        }

        async function sendMessageToChatServer(ctx, params) {
            if (!params || typeof params !== 'object' || !params.message) {
                throw new Error('Invalid parameters. Ensure a valid message payload.');
            }

            const chatApiClient = new UniversalApiClient({
                baseUrl: chatServerEndpoint,
                authType: 'none',
            });
            
            const response = await chatApiClient.post('/api/chat/send', {
                message: params.message,
                sender: 'TeamsBot',
            });
            
            return response;
        }

        if (!context.actions.sendMessageToChatServer) {
            context.actions.sendMessageToChatServer = sendMessageToChatServer;
        }

        subscribeToTeamsMessages();
        createChatGPTChannel();

        console.log('Teams chat plugin with Microsoft Graph API event subscriptions and AI Help channel registered successfully.');
    },
};

