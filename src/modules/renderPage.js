// renderPage.js
const snowflake = require('snowflake-sdk');

// Helper function to perform a simple templating replacement.
// It looks for placeholders like {{key}} in the template string and
// replaces them with the corresponding value from the data object.
function replacePlaceholders(template, data) {
  if (!template) return '';
  return template.replace(/{{(\w+)}}/g, (match, key) => {
    return data[key] !== undefined ? data[key] : match;
  });
}

/**
 * renderPage: Retrieves a page record from Snowflake and assembles the HTML.
 *
 * @param {number} pageId - The ID of the page record to retrieve.
 * @param {Function} callback - A callback function (err, html) that will be called with the assembled HTML.
 */
function renderPage(pageId, callback) {
  // Create a Snowflake connection.
  const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USERNAME,
    password: process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: 'FIVETRAN_DATABASE',
    schema: 'LE_PROD_PUBLIC'
  });

  // Connect to Snowflake.
  connection.connect((err, conn) => {
    if (err) {
      return callback(new Error('Unable to connect to Snowflake: ' + err.message));
    }

    // Query the record using a parameterized query.
    const sqlText = `
      SELECT
        ID,
        HEADER_SCRIPTS,
        BODY,
        FOOTER_SCRIPTS,
        TITLE,
        OPTIONS
      FROM PAGES
      WHERE ID = ?
    `;
    connection.execute({
      sqlText,
      binds: [pageId],
      complete: (err, stmt, rows) => {
        if (err) {
          return callback(new Error('Query error: ' + err.message));
        }
        if (!rows || rows.length === 0) {
          return callback(new Error('Page not found'));
        }

        const record = rows[0];

        // Parse the OPTIONS JSON. If it fails, we log an error but continue with an empty object.
        let options = {};
        try {
          options = JSON.parse(record.OPTIONS);
        } catch (e) {
          console.error('Error parsing OPTIONS JSON:', e);
        }

        // Replace placeholders in the HTML parts using the OPTIONS values.
        const headerScripts = replacePlaceholders(record.HEADER_SCRIPTS, options);
        const bodyContent   = replacePlaceholders(record.BODY, options);
        const footerScripts = replacePlaceholders(record.FOOTER_SCRIPTS, options);

        // Assemble the final HTML page.
        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${record.TITLE || ''}</title>
  ${headerScripts}
</head>
<body>
  ${bodyContent}
  ${footerScripts}
</body>
</html>
        `;

        // Return the assembled HTML via the callback.
        callback(null, html);
      }
    });
  });
}

module.exports = {
  renderPage
};
