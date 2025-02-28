const express = require('express');
const bodyParser = require('body-parser');

module.exports = {
    name: 'slackChatPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for slackChatPlugin.');
        }

        const slackToken = process.env.SLACK_BOT_TOKEN;
        const slackChannel = process.env.SLACK_CHANNEL;
        const chatServerEndpoint = process.env.CHAT_SERVER_ENDPOINT;
        const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

        if (!slackToken || !slackChannel || !chatServerEndpoint || !slackSigningSecret) {
            throw new Error('Missing required Slack configurations. Ensure SLACK_BOT_TOKEN, SLACK_CHANNEL, CHAT_SERVER_ENDPOINT, and SLACK_SIGNING_SECRET are set.');
        }

        const slackApiClient = new UniversalApiClient({
            baseUrl: 'https://slack.com/api',
            authType: 'token',
            authValue: slackToken,
        });

        const app = express();
        app.use(bodyParser.json());

        app.post('/slack/events', async (req, res) => {
            const { type, event } = req.body;

            if (type === 'url_verification') {
                return res.json({ challenge: req.body.challenge });
            }

            if (type === 'event_callback' && event && event.type === 'message' && !event.bot_id) {
                const message = event.text.trim();
                const isAiQuery = message.toLowerCase().startsWith('/ai');
                let responseText = '';

                if (isAiQuery) {
                    const aiPrompt = message.slice(3).trim();
                    const aiResponse = await context.actions.processAIMessage(null, { message: aiPrompt });
                    responseText = aiResponse.text;
                } else {
                    responseText = `Echo: ${message}`;
                }

                await slackApiClient.post('/chat.postMessage', {
                    channel: slackChannel,
                    text: responseText,
                });
            }

            res.status(200).send();
        });

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
                sender: 'SlackBot',
            });
            
            return response;
        }

        if (!context.actions.sendMessageToChatServer) {
            context.actions.sendMessageToChatServer = sendMessageToChatServer;
        }

        console.log('Slack chat plugin with event subscriptions registered successfully.');
    },
};
