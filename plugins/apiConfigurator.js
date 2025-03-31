const fs = require('fs');
const path = require('path');
const express = require('express');

let configFile;
let backupDir;

module.exports = {
  name: 'apiConfigurator',
  version: '1.0.0',
  initialize({ app }) {
    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
    configFile = path.join(configDir, 'apiConfig.json');
    backupDir = path.join(configDir, 'backups');

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const router = express.Router();

    /**
     * POST /api-configurator/save
     * Overwrites the apiConfig.json and creates a timestamped backup
     */
    router.post('/save', (req, res) => {
      const newConfig = req.body;

      if (!Array.isArray(newConfig)) {
        return res.status(400).json({ error: 'Invalid config format. Expected an array of endpoints.' });
      }

      try {
        // Backup existing config
        if (fs.existsSync(configFile)) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupFile = path.join(backupDir, `apiConfig-${timestamp}.json`);
          fs.copyFileSync(configFile, backupFile);
          console.log(`Backup created: ${backupFile}`);
        }

        // Write the new configuration
        fs.writeFileSync(configFile, JSON.stringify(newConfig, null, 2), 'utf-8');
        console.log('apiConfig.json updated successfully.');

        return res.json({ message: 'Configuration saved. Backup created.' });
      } catch (err) {
        console.error('Failed to save configuration:', err.message);
        return res.status(500).json({ error: 'Failed to save configuration.' });
      }
    });

    app.use('/api-configurator', router);
  },

  cleanup() {
    console.log('API Configurator plugin cleanup complete.');
  }
};