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

const envVars = parseEnv(envPath);

const outputContent = `// Auto-generated from root .env by sync-env.js. DO NOT COMMIT (gitignored).
export const LOCAL_ENV = ${JSON.stringify(envVars, null, 2)};
globalThis.LOCAL_ENV = LOCAL_ENV;
`;

fs.writeFileSync(targetPath, outputContent, 'utf8');
console.log(`[sync-env] Successfully synced .env to ${targetPath}`);
