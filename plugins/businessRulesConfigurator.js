const fs = require('fs');
const path = require('path');

let DSLParser, RuleEngine;

const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
const rulesPath = path.join(configDir, 'businessRules.dsl');

// Global plugin-scoped context
let globalContext = {};
module.exports = {
  name: 'businessRulesConfigurator',
  version: '1.0.0',

  initialize(dependencies) {
    const { customRequire, context } = dependencies;
    globalContext = context;
    console.log('[businessRulesDSL] Initializing plugin...');

    DSLParser = customRequire('../src/modules/dslparser');
    RuleEngine = customRequire('../src/modules/ruleEngine');


    // Initialize DSL file if missing
    if (!fs.existsSync(rulesPath)) {
      fs.writeFileSync(rulesPath, '', 'utf8');
      console.log(`[businessRulesDSL] Created blank rules file at: ${rulesPath}`);
    }

    // Register capabilities to global context
    if (!context.actions.validateDSL) {
      context.actions.validateDSL = async (ctx, params) => {
        try {
          const { dsl } = params;
          const parser = new DSLParser(globalContext);
          const ast = parser.parse(dsl);
          return { success: true, ast };
        } catch (err) {
          return { success: false, error: err.message };
        }
      };
    }

    if (!context.actions.getDSL) {
      context.actions.getDSL = async () => {
        const dsl = fs.readFileSync(rulesPath, 'utf8');
        return { dsl };
      };
    }

    if (!context.actions.saveDSL) {
      context.actions.saveDSL = async (ctx, params) => {
        const { dsl } = params;
        try {
          const parser = new DSLParser(globalContext);
          parser.parse(dsl);
          fs.writeFileSync(rulesPath, dsl, 'utf8');
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      };
    }
  },

  registerRoutes({ app }) {
    const routes = [];

    // GET /ui/rules
    app.get(
      '/ui/rules',
      (req, res) => {
        const dsl = fs.readFileSync(rulesPath, 'utf8');
        res.json({ dsl });
      }
    );
    routes.push({ method: 'get', path: '/ui/rules' });

    // POST /ui/rules
    app.post(
      '/ui/rules',
      (req, res) => {
        const { dsl } = req.body;
        if (!dsl || typeof dsl !== 'string') {
          return res.status(400).json({ error: 'Invalid DSL input' });
        }

        try {
          const parser = new DSLParser(globalContext);
          parser.parse(dsl);
          fs.writeFileSync(rulesPath, dsl, 'utf8');
          res.json({ success: true });
        } catch (err) {
          res.status(400).json({ error: err.message });
        }
      }
    );
    routes.push({ method: 'post', path: '/ui/rules' });

    // POST /ui/rules/validate
    app.post(
      '/ui/rules/validate',
      (req, res) => {
        const { dsl } = req.body;
        if (!dsl || typeof dsl !== 'string') {
          return res.status(400).json({ errors: ['DSL must be a string'] });
        }

        try {
          const parser = new DSLParser(globalContext);
          const ast = parser.parse(dsl);
          res.json({ ast });
        } catch (err) {
          res.status(400).json({ errors: [err.message] });
        }
      }
    );
    routes.push({ method: 'post', path: '/ui/rules/validate' });

    // GET /ui/capabilities
    app.get(
      '/ui/capabilities',
      (req, res) => {
        console.log(globalContext.actions);
        const actions = Object.keys(globalContext.actions || {});
        res.json({ actions });
      }
    );
    routes.push({ method: 'get', path: '/ui/capabilities' });

    return routes;
  },

  async cleanup() {
    console.log('[businessRulesDSL] Cleaning up plugin...');
    // Future cleanup logic if needed
  },
};
