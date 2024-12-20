class Logger {
    constructor() {
        // Check if logging is enabled from the environment variable
        // Convert string value to boolean
        this.isLoggingEnabled = (process.env.ENABLE_LOGGING || '').toLowerCase() === 'true';

        if (this.isLoggingEnabled) {
            console.log('Logging is enabled.');
        } else {
            console.log('Logging is disabled.');
        }
    }

    log(...args) {
        if (this.isLoggingEnabled) {
            console.log(...args);
        }
    }

    error(...args) {
        if (this.isLoggingEnabled) {
            console.error(...args);
        }
    }

    warn(...args) {
        if (this.isLoggingEnabled) {
            console.warn(...args);
        }
    }
}

module.exports = new Logger();
