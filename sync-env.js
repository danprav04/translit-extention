const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const targetDir = path.join(__dirname, 'src');
const targetPath = path.join(targetDir, 'config.local.js');

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[sync-env] Warning: ${filePath} not found. Using defaults.`);
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      let value = trimmed.substring(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  });
  return env;
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const configPath = path.join(targetDir, 'config.js');
const envVars = parseEnv(envPath);

if (fs.existsSync(configPath)) {
  let configContent = fs.readFileSync(configPath, 'utf8');
  if (envVars.GEMINI_API_KEY) {
    configContent = configContent.replace(/apiKey:\s*["'][^"']*["']/, `apiKey: "${envVars.GEMINI_API_KEY}"`);
  }
  if (envVars.PRIMARY_MODEL) {
    configContent = configContent.replace(/primaryModel:\s*["'][^"']*["']/, `primaryModel: "${envVars.PRIMARY_MODEL}"`);
  }
  if (envVars.FALLBACK_MODEL) {
    configContent = configContent.replace(/fallbackModel:\s*["'][^"']*["']/, `fallbackModel: "${envVars.FALLBACK_MODEL}"`);
  }
  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log(`[sync-env] Successfully synced .env values into ${configPath}`);
} else {
  console.warn(`[sync-env] Warning: ${configPath} not found.`);
}

// Clean up old gitignored config.local.js if it exists so there are no orphan files
const oldLocalPath = path.join(targetDir, 'config.local.js');
if (fs.existsSync(oldLocalPath)) {
  fs.unlinkSync(oldLocalPath);
}
