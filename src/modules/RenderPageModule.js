const { aarMiddleware } = require('../middleware/aarMiddleware');
const { query  } = require('./db');

class RenderPageModule {
   //  RenderPageModule(globalContext,{ dbType: "mysql", dbConnection: "MYSQL_1" }, app);
  constructor(globalContext, dbConfig,app) {
      this.globalContext = globalContext;
      this.dbConfig = dbConfig;
      this.app = app;
      this.ruleEngineInstance = this.app.locals.ruleEngineMiddleware;
      this.acl = [process.env.DEFAULT_ADMIN || 'admin'];
      this.registerActions();
      this.registerRoutes() 
  }

  registerActions() {
      this.globalContext.actions.render_page = this.renderPage.bind(this);
  }

  /**
   * Replaces placeholders in the form of {{key}} in the template with data values.
   * @param {string} template 
   * @param {object} data 
   * @returns {string}
   */
  replacePlaceholders(template, data) {
      if (!template) return '';
      return template.replace(/{{(\w+)}}/g, (match, key) => {
          return data[key] !== undefined ? data[key] : match;
      });
  }

  /**
   * Fetch and render a dynamic HTML page from the PAGES table.
   * @param {object} ctx - Adaptus2 context with db config
   * @param {object} params - { pageId: number }
   */
  async renderPage(ctx, params) {
      const { pageId } = params;
      if (!pageId) {
          throw new Error("Missing 'pageId' parameter.");
      }

      try {
          
          
          const queryStr = `
              SELECT ID, HEADER_SCRIPTS, BODY, FOOTER_SCRIPTS, TITLE, OPTIONS
              FROM pages
              WHERE ID = ?
              LIMIT 1
          `;

          const rows = await query(this.dbConfig, queryStr, [pageId]);

          if (!rows || rows.length === 0) {
              throw new Error("Page not found.");
          }

          const record = rows[0];
          let options = {};
          try {
              options = JSON.parse(record.OPTIONS);
          } catch (e) {
              console.warn("Error parsing OPTIONS JSON:", e.message);
          }

          const header = this.replacePlaceholders(record.HEADER_SCRIPTS, options);
          const body = this.replacePlaceholders(record.BODY, options);
          const footer = this.replacePlaceholders(record.FOOTER_SCRIPTS, options);

          const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${record.TITLE || ''}</title>
${header}
</head>
<body>
${body}
${footer}
</body>
</html>`;

          return { html };
      } catch (error) {
          console.error("Error in renderPage:", error.message);
          throw new Error("Failed to render page: " + error.message);
      }
  }

  registerRoutes() {
    if (!this.app || !this.ruleEngineInstance) return;

    this.app.get(
        '/render/:pageId',
        aarMiddleware(null, null, this.ruleEngineInstance), // apply security
        async (req, res) => {
            try {
                const ctx = {
                    config: {
                        db: this.dbConfig
                    },
                    data: {}
                };
                const result = await this.renderPage(ctx, { pageId: req.params.pageId });
                res.setHeader('Content-Type', 'text/html');
                res.send(result.html);
            } catch (error) {
                console.error("Route error:", error.message);
                res.status(500).send("Internal Server Error: " + error.message);
            }
        }
    );
  }


}

module.exports = RenderPageModule;
