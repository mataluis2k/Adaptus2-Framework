const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const session = require('express-session');
const { globalContext } = require('../modules/context'); // Import shared globalContext

module.exports = {
    name: 'socialLoginPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        console.log('Initializing socialLoginPlugin...');
        this.extendContext(dependencies);
        this.configurePassport();
    },

    async cleanup() {
        console.log('Cleaning up socialLoginPlugin...');
        // Perform any necessary cleanup
    },

    configurePassport() {
        // Configure Passport serialization
        passport.serializeUser((user, done) => {
            done(null, user);
        });

        passport.deserializeUser((obj, done) => {
            done(null, obj);
        });

        // Add Google Strategy
        passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: `${process.env.SERVER_URL}/auth/google/callback`,
        }, (accessToken, refreshToken, profile, done) => {
            console.log('Google Profile:', profile);
            return done(null, profile);
        }));

        // Add Facebook Strategy
        passport.use(new FacebookStrategy({
            clientID: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackURL: `${process.env.SERVER_URL}/auth/facebook/callback`,
        }, (accessToken, refreshToken, profile, done) => {
            console.log('Facebook Profile:', profile);
            return done(null, profile);
        }));
    },

    extendContext(dependencies) {
        const app = dependencies.app;

        // Add Middleware for session and passport
        app.use(session({ secret: process.env.SESSION_SECRET || 'super_secret', resave: false, saveUninitialized: true }));
        app.use(passport.initialize());
        app.use(passport.session());

        // Register Routes for Social Login
        app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
        app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }),
            (req, res) => res.redirect('/profile')
        );

        app.get('/auth/facebook', passport.authenticate('facebook'));
        app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/' }),
            (req, res) => res.redirect('/profile')
        );

        app.get('/profile', (req, res) => {
            if (!req.isAuthenticated()) {
                return res.redirect('/');
            }
            res.json(req.user); // Return user profile
        });
    },
};
