require('dotenv').config();
const winston = require('winston');

// Ensure logger is initialized before use
let loggerInstance = null;

// Helper function to handle circular references
const getCircularReplacer = () => {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular Reference]';
            }
            seen.add(value);
        }
        return value;
    };
};

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            handleExceptions: true,
            handleRejections: true
        }),
        new winston.transports.File({
            filename: 'error.log',
            level: 'error',
            handleExceptions: true,
            handleRejections: true,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            eol: '\n',
            options: { flags: 'a' }
        })
    ],
    exitOnError: false
});

// Add error event handlers for the file transport
logger.transports.forEach(transport => {
    if (transport instanceof winston.transports.File) {
        transport.on('error', (error) => {
            console.error('Error in file transport:', error);
        });
    }
});

class Logger {
    constructor() {
        this.isLoggingEnabled = (process.env.ENABLE_LOGGING || '').toLowerCase() === 'true';
        
        if (this.isLoggingEnabled) {
            logger.info('Logging is enabled.');
        } else {
            logger.info('Logging is disabled.');
        }
    }
    
    info(...args) {
        if (this.isLoggingEnabled) {
            try {
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg, getCircularReplacer()) : String(arg)
                ).join(' ');
                logger.info(message);
            } catch (error) {
                logger.error('Error in log method:', error);
            }
        }
    }

    log(...args) {
        if (this.isLoggingEnabled) {
            try {
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg, getCircularReplacer()) : String(arg)
                ).join(' ');
                logger.info(message);
            } catch (error) {
                logger.error('Error in log method:', error);
            }
        }
    }

    error(...args) {
        if (this.isLoggingEnabled) {
            try {
                const message = args.map(arg => {
                    if (arg instanceof Error) {
                        return arg.stack || arg.message;
                    }
                    return typeof arg === 'object' ? JSON.stringify(arg, getCircularReplacer()) : String(arg);
                }).join(' ');
                logger.error(message);
            } catch (error) {
                logger.error('Error in error method:', error);
            }
        }
    }

    warn(...args) {
        if (this.isLoggingEnabled) {
            try {
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg, getCircularReplacer()) : String(arg)
                ).join(' ');
                logger.warn(message);
            } catch (error) {
                logger.error('Error in warn method:', error);
            }
        }
    }
}

// Initialize logger instance only once
const getLogger = () => {
    if (!loggerInstance) {
        loggerInstance = new Logger();
    }
    return loggerInstance;
};

// Cleanup function for graceful shutdown
const cleanupLogger = () => {
    if (logger) {
        logger.transports.forEach(transport => {
            if (transport instanceof winston.transports.File) {
                transport.on('finish', () => {
                    transport.close();
                });
            }
        });
        logger.end();
    }
};

// Handle process termination
process.on('SIGTERM', cleanupLogger);
process.on('SIGINT', cleanupLogger);

// Export singleton logger instance and cleanup function
module.exports = getLogger();
module.exports.cleanup = cleanupLogger;
module.exports.getInstance = getLogger;
