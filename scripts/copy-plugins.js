const fs = require('fs');
const path = require('path');

// Define paths
const pluginDir = path.join(__dirname, '../plugin'); // Adjust relative to the script
const userDir = path.join(require('os').homedir(), '.adaptus2', 'plugin'); // Adjust the user directory as needed

// Function to copy directory
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source directory does not exist: ${src}`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  fs.readdirSync(src).forEach((item) => {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

// Perform the copy
try {
  console.log(`Copying plugin directory from ${pluginDir} to ${userDir}`);
  copyDir(pluginDir, userDir);
  console.log('Plugin directory copied successfully!');
} catch (err) {
  console.error('Error copying plugin directory:', err.message);
  process.exit(1);
}
