const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { aarMiddleware } = require('../middleware/aarMiddleware');
require('dotenv').config();

class PageCloneModule {
  constructor(globalContext, dbConfig, app) {
    this.globalContext = globalContext;
    this.dbConfig = dbConfig;
    this.app = app;
    this.ruleEngineInstance = this.app.locals.ruleEngineMiddleware;
    this.registerActions();
    this.registerRoutes();
  }

  registerActions() {
    this.globalContext.actions.clone_and_store_page = this.cloneAndStorePage.bind(this);
  }

  registerRoutes() {
    this.app.post(
      '/ui/getPage',
      ...aarMiddleware(null, null, this.ruleEngineInstance),
      async (req, res) => {
        try {
          const result = await this.cloneAndStorePage({ config: this.dbConfig }, req.body);
          res.json(result);
        } catch (err) {
          console.error("Failed to process /ui/getPage:", err);
          res.status(500).json({ error: 'Internal Server Error', details: err.message });
        }
      }
    );
  }

  async cloneAndStorePage(ctx, params) {
    const { url } = params;
    if (!url) throw new Error("Missing 'url' in request body");

    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const title = $('title').text();

    const assetBaseUrl = (process.env.LOCAL_DOMAIN || '') + (process.env.ASSETS_URL_PATH || '/assets');
    const assetDiskPath = process.env.ASSETS_DISK_PATH || path.join(__dirname, '../public/assets');
    const resourceMap = {};

    const downloadAndReplace = async (selector, attr) => {
      const elements = $(selector);
      for (let i = 0; i < elements.length; i++) {
        const elem = elements[i];
        const src = $(elem).attr(attr);
        if (src && (src.startsWith('http') || src.startsWith('//'))) {
          try {
            const ext = path.extname(src.split('?')[0]);
            const filename = `${uuidv4()}${ext}`;
            const filePath = path.join(assetDiskPath, filename);
            const fileUrl = `${assetBaseUrl}/${filename}`;

            const fileResponse = await axios.get(src.startsWith('//') ? `https:${src}` : src, { responseType: 'arraybuffer' });
            await fs.writeFile(filePath, fileResponse.data);

            $(elem).attr(attr, fileUrl);
            resourceMap[src] = fileUrl;
          } catch (error) {
            console.warn(`Failed to download ${src}:`, error.message);
          }
        }
      }
    };

    await fs.mkdir(assetDiskPath, { recursive: true });
    await downloadAndReplace('script[src]', 'src');
    await downloadAndReplace('link[rel="stylesheet"]', 'href');
    await downloadAndReplace('img[src]', 'src');

    const headerScripts = $('head').html();
    const footerScripts = $('footer').html() || '';
    const bodyContent = $('body').html();

    const record = {
      entity: 'pages',
      data: {
        TITLE: title,
        HEADER_SCRIPTS: headerScripts,
        BODY: bodyContent,
        FOOTER_SCRIPTS: footerScripts,
        OPTIONS: JSON.stringify({ source: url, resourceMap })
      }
    };

    const result = await this.globalContext.actions.create_record(ctx, record);

    // Need to return the cloned page in data.content for the Front end to display.


            const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>${headerScripts}</head>
        <body>${bodyContent}${footerScripts}</body>
        </html>
        `;

        return {
        success: true,
        message: 'Page cloned and stored',
        id: result.id,
        content: htmlContent // ✅ this is what frontend iframe can use
        };
  }

}

module.exports = PageCloneModule;
