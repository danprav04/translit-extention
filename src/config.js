// Configuration management combining local defaults with chrome.storage user settings.

export const DEFAULT_CONFIG = {
  apiKey: "", // Configure via Extension Options or local .env -> npm run sync
  primaryModel: "gemini-3.1-flash-lite-preview",
  fallbackModel: "gemma-4-31b-it",
  systemPrompt: `You are an expert multi-language transliteration and keyboard-layout restoration assistant.
Your task is to scan the user's input text, identify any language mistakes, transliteration/romanization (e.g. Russian/Hebrew/Greek/Hindi/Japanese written in Latin script like 'privet kak dela' or 'shalam'), or wrong keyboard layout mistakes (e.g. typing English characters on a Russian/Hebrew/Greek layout like 'ghivet' instead of 'привет' or 'u,uho' instead of 'שלום', or vice versa), and output the corrected, restored text in its true original native language script.

CRITICAL RULES:
1. You MUST enclose the final restored text inside <restored> and </restored> tags. Example: <restored>давай сюда</restored>
2. Do not add any analysis, explanations, notes, bullet points, or quotation marks outside or inside the <restored></restored> tags.
3. If the input contains multiple languages (e.g. Russian mixed with legitimate English words or URLs), restore the transliterated/layout-swapped parts to their original script while keeping the legitimate English words, technical terms, code snippets, emails, and URLs exactly as they are.
4. If the input is already entirely correct and in its native script without any transliteration or layout errors, return the input text exact inside <restored></restored> tags.
5. Preserve the original punctuation, capitalization, line breaks, and spacing precisely.`,
  customShortcut: "", // If set (e.g. "Alt+T" or "Ctrl+Shift+Y"), content script listens for this directly on webpage
  autoReplace: true
};

/**
 * Get current configuration from chrome.storage.sync (falling back to DEFAULT_CONFIG)
 */
export async function getConfig() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG), (items) => {
        const result = { ...DEFAULT_CONFIG, ...items };
        // Ensure that if chrome.storage had empty apiKey initially, we fallback to our .env key
        if (!result.apiKey && DEFAULT_CONFIG.apiKey) {
          result.apiKey = DEFAULT_CONFIG.apiKey;
        }
        resolve(result);
      });
    } else {
      resolve(DEFAULT_CONFIG);
    }
  });
}

/**
 * Save updated settings to chrome.storage.sync
 */
export async function saveConfig(updates) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(updates, () => {
        resolve(true);
      });
    } else {
      resolve(false);
    }
  });
}
