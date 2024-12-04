const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const jwt = require('jsonwebtoken');

const oauthCallbackURL = process.env.OAUTH_CALLBACK_URL || 'http://localhost:3000/auth/callback';
const clientID = process.env.OAUTH_CLIENT_ID || 'your-client-id';
const clientSecret = process.env.OAUTH_CLIENT_SECRET || 'your-client-secret';
const authorizationURL = process.env.OAUTH_AUTH_URL || 'https://provider.com/oauth/authorize';
const tokenURL = process.env.OAUTH_TOKEN_URL || 'https://provider.com/oauth/token';
const JWT_SECRET = process.env.JWT_SECRET || 'IhaveaVeryStrongSecret';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// Configure OAuth strategy
passport.use(
  new OAuth2Strategy(
    {
      authorizationURL,
      tokenURL,
      clientID,
      clientSecret,
      callbackURL: oauthCallbackURL,
    },
    (accessToken, refreshToken, profile, done) => {
      // Simulate user lookup or creation
      const user = {
        id: profile.id,
        username: profile.username || profile.email,
        token: accessToken,
      };
      return done(null, user);
    }
  )
);

// Serialize and deserialize user for session persistence
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Middleware to protect routes
const authenticateOAuth = (req, res, next) => {
  passport.authenticate('oauth2', { session: false }, (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Unauthorized' });

    // Generate JWT token for the user
    const tokenPayload = { id: user.id, username: user.username };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    req.user = user; // Attach user details to request object
    req.token = token; // Attach JWT for further usage
    next();
  })(req, res, next);
};

module.exports = { passport, authenticateOAuth };
