const axios = require('axios');
const jwt = require('jsonwebtoken');

let globalConfig;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || 'YourSuperSecretKey';

function initialize(dependencies) {
  globalConfig = dependencies.context;
}

function registerRoutes({ app }) {
  // Exchange Facebook token and register/login the user
  app.post('/auth/facebook', async (req, res) => {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Missing access_token' });

    try {
      // Verify Facebook token and fetch user info
      const fbResponse = await axios.get(`https://graph.facebook.com/me?fields=id,name,email&access_token=${access_token}`);
      const { id: fbId, name, email } = fbResponse.data;

      // Search for user in the database (assume Users table)
      const ctx = { config: req.app.locals.apiConfig.find(cfg => cfg.dbTable === 'Users') };
      const existingUser = await globalConfig.actions.read(ctx, { entity: 'Users', query: { facebook_id: fbId } });

      let user;
      if (existingUser && existingUser.length > 0) {
        user = existingUser[0];
      } else {
        // Register the user
        const userData = { facebook_id: fbId, name, email };
        await globalConfig.actions.create_record(ctx, { entity: 'Users', data: userData });
        user = userData;
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id || fbId, email }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ message: 'Login successful', token });
    } catch (error) {
      console.error('Facebook OAuth Error:', error.message);
      res.status(500).json({ error: 'Facebook OAuth failed' });
    }
  });

  return [{ method: 'post', path: '/auth/facebook' }];
}

module.exports = { initialize, registerRoutes };
