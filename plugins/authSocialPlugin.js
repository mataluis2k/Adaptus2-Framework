// authSocialPlugin.js
const moment = require('moment');
let dbFunctions = {};
let baseURL;

module.exports = {
    name: 'authSocialPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing authSocialPlugin...');
        const { customRequire, context, app } = dependencies;

        dbFunctions = customRequire('../src/modules/db');
        this.genToken = customRequire('../src/modules/genToken');
        this.response = customRequire('../src/modules/response');
        this.apiConfig = customRequire('../src/modules/apiConfig');
        const passport = customRequire('passport');
        const FacebookStrategy = customRequire('passport-facebook').Strategy;
        const GoogleStrategy = customRequire('passport-google-oauth20').Strategy;
        baseURL = process.env.SOCIAL_BASE_URL || 'http://localhost:5173';
        defaultACL = process.env.SOCIAL_DEFAULT_ACL || 'publicAccess';
        const allowRead =  ['id','name', 'email', 'status', 'created_at', 'platform', 'acl' ];

        passport.serializeUser((user, done) => done(null, user.uuid));
        passport.deserializeUser(async (id, done) => {
            const user = await dbFunctions.read({ dbType: process.env.DEFAULT_DBTYPE, dbConnection: process.env.DEFAULT_DBCONNECTION }, 'users_v2', { uuid: id });
            done(null, user[0]);
        });

        // Facebook Strategy
        passport.use(new FacebookStrategy({
            clientID: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackURL: `${baseURL}/auth/facebook/callback`,
            profileFields: ['id', 'emails', 'name']
        }, async (accessToken, refreshToken, profile, done) => {
            const user = await this.findOrCreateUser(profile, 'facebook');
            return done(null, user);
        }));

        // Google Strategy
        passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: `${baseURL}/auth/google/callback`
        }, async (accessToken, refreshToken, profile, done) => {
            const user = await this.findOrCreateUser(profile, 'google');
            return done(null, user);
        }));

        app.use(passport.initialize());

        app.post('/auth/mobile-login', async (req, res) => {
            const { provider, access_token, id_token } = req.body;
          
            try {
              let profile;
          
              if (provider === 'google') {
                const { OAuth2Client } = require('google-auth-library');
                const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
                const ticket = await client.verifyIdToken({
                  idToken: id_token,
                  audience: process.env.GOOGLE_CLIENT_ID,
                });
                const payload = ticket.getPayload();
                profile = {
                  emails: [{ value: payload.email }],
                  displayName: payload.name,
                  name: { givenName: payload.given_name, familyName: payload.family_name },
                };
              } else if (provider === 'facebook') {
                const fetch = require('node-fetch');
                const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${access_token}`);
                const fbData = await fbRes.json();
                profile = {
                  emails: [{ value: fbData.email }],
                  displayName: fbData.name,
                  name: { givenName: fbData.name.split(' ')[0], familyName: fbData.name.split(' ').slice(1).join(' ') },
                };
              } else {
                return res.status(400).json({ error: 'Unsupported provider' });
              }
          
              const user = await this.findOrCreateUser(profile, provider);
              const token = await this.genToken(user, allowRead, 'password');
              res.status(200).json({ token, user });
            } catch (err) {
              console.error('Mobile login error:', err);
              res.status(401).json({ error: 'Authentication failed' });
            }
        });

        // Facebook auth routes
        app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));

        app.get('/auth/facebook/callback', passport.authenticate('facebook', { session: false }), async (req, res) => {
            //const user = await this.findOrCreateUser(req.user, 'facebook');
            const token = await this.genToken(req.user,allowRead, 'password');
            res.redirect(`${baseURL}/login-success?token=${token}`);
        });

        // Google auth routes
        app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

        app.get('/auth/google/callback', passport.authenticate('google', { session: false }), async (req, res) => {
            //const user = await this.findOrCreateUser(req.user, 'google');
            const token = await this.genToken(req.user,allowRead, 'password');
            res.redirect(`${baseURL}/login-success?token=${token}`);
        });

        // Helper action
        context.actions.findOrCreateUser = async (ctx, params) => {
            return await this.findOrCreateUser(params.profile, params.provider);
        };
    },

    async findOrCreateUser(profile, provider) {
      const dbConfig = { dbType: process.env.DEFAULT_DBTYPE, dbConnection: process.env.DEFAULT_DBCONNECTION };
      
      // Check if the profile is already a user object (has email property directly)
      if (profile.email) {
          console.log('Profile is already a user object');
          return profile;
      }
      
      // Check if profile.emails exists and has at least one element
      if (!profile.emails || !profile.emails.length) {
          console.error('Profile missing email information:', profile);
          throw new Error('Profile missing email information');
      }
      
      const email = profile.emails[0].value;
      let user = await dbFunctions.read(dbConfig, 'users_v2', { email });

      if (user.length > 0) {
          console.log('User already exists:', user[0]);
          return user[0]; // Return the first user object, not the array
      }
      
      // create filler password
      const password = Math.random().toString(36).slice(-8);
      const created_at = moment().utc().format('YYYY-MM-DD HH:mm:ss');
      const { v7: uuidv7 } = require('uuid');
      const newUser = {
          uuid: uuidv7(),
          email,
          name: profile.displayName || (profile.name ? `${profile.name.givenName || ''} ${profile.name.familyName || ''}`.trim() : 'User'),
          status: 'active',
          password: password,
          created_at: created_at,
          platform: 'web',
          acl:'publicAccess'
      };

      await dbFunctions.create(dbConfig, 'users_v2', newUser);
      return newUser;
  }
};
