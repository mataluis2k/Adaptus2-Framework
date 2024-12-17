class Logger {
    constructor() {
        // Check if logging is enabled from the environment variable
        this.isLoggingEnabled = process.env.ENABLE_LOGGING === 'true';
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
