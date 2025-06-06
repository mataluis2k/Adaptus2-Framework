const db = require('../modules/db');
const { getContext } = require('../modules/context');

function requestLoggingMiddleware() {
  return async (req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;
    const originalJson = res.json;

    let responseBody;

    // Wrapper for res.send
    res.send = function (body) {
      responseBody = body;
      return originalSend.apply(res, arguments);
    };

    // Wrapper for res.json
    res.json = function (body) {
      responseBody = JSON.stringify(body);
      return originalJson.apply(res, arguments);
    };

    res.on('finish', async () => {
      const duration = Date.now() - start;
      const user = getContext('user');

      const logData = {
        request_id: req.id,
        timestamp_start: new Date(start).toISOString().slice(0, 23).replace('T', ' '),
        timestamp_end: new Date(Date.now()).toISOString().slice(0, 23).replace('T', ' '),
        method: req.method,
        url: req.originalUrl,
        path: req.path,
        query_params: JSON.stringify(req.query),
        headers: JSON.stringify(req.headers),
        body: JSON.stringify(req.body),
        response_body: responseBody,
        response_status: res.statusCode,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        user_id: user ? user.id : null,
        duration_ms: duration,
        encrypted: false, // Assuming default, adjust as needed
      };

      try {
        const dbConfig = {
          dbType: process.env.REQUEST_LOG_DB_TYPE || 'mysql',
          dbConnection: process.env.REQUEST_LOG_DB_CONNECTION || 'MYSQL_1',
        };

        // *** FIX: Added options object with skipResponse: true ***
        await db.create(dbConfig, 'request_logs', logData, { skipResponse: true });
        
      } catch (error) {
        console.error('Failed to log request:', error.message);
      }
    });

    next();
  };
}

module.exports = requestLoggingMiddleware;
