const winston = require('winston');

const logLevel = process.env.LOG_LEVEL || 'info';

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`;
    }
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: customFormat,
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    })
  ]
});

// In production, also log to files
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));
  
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));
}

// Stream for Morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

module.exports = logger;
