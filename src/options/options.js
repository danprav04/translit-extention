import { getConfig, saveConfig, DEFAULT_CONFIG } from '../config.js';

document.addEventListener('DOMContentLoaded', async () => {
  const inputApiKey = document.getElementById('input-api-key');
  const inputPrimaryModel = document.getElementById('input-primary-model');
  const inputFallbackModel = document.getElementById('input-fallback-model');
  const inputCustomShortcut = document.getElementById('input-custom-shortcut');
  const checkAutoReplace = document.getElementById('check-auto-replace');
  const inputSystemPrompt = document.getElementById('input-system-prompt');
  const currentChromeCmd = document.getElementById('current-chrome-cmd');
  const toastEl = document.getElementById('toast-notify');

  // Load current configuration
  async function loadFormValues() {
    const config = await getConfig();
    inputApiKey.value = config.apiKey || "";
    inputPrimaryModel.value = config.primaryModel || DEFAULT_CONFIG.primaryModel;
    inputFallbackModel.value = config.fallbackModel || DEFAULT_CONFIG.fallbackModel;
    inputCustomShortcut.value = config.customShortcut || "";
    checkAutoReplace.checked = config.autoReplace !== false;
    inputSystemPrompt.value = config.systemPrompt || DEFAULT_CONFIG.systemPrompt;

    if (typeof chrome !== 'undefined' && chrome.commands) {
      chrome.commands.getAll((commands) => {
        const translitCmd = commands.find(c => c.name === "translit-selection");
        if (translitCmd && translitCmd.shortcut) {
          currentChromeCmd.textContent = translitCmd.shortcut;
        } else {
          currentChromeCmd.textContent = "Alt + Shift + T";
        }
      });
    }
  }

  await loadFormValues();

  // Toggle API key visibility
  const toggleBtn = document.getElementById('toggle-key-visibility');
  toggleBtn.addEventListener('click', () => {
    if (inputApiKey.type === 'password') {
      inputApiKey.type = 'text';
      toggleBtn.textContent = '🙈';
    } else {
      inputApiKey.type = 'password';
      toggleBtn.textContent = '👁️';
    }
  });

  // Open Chrome Shortcuts settings
  document.getElementById('btn-open-chrome-shortcuts').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } else {
      window.open('chrome://extensions/shortcuts');
    }
  });

  // Save changes
  document.getElementById('btn-save').addEventListener('click', async () => {
    const updates = {
      apiKey: inputApiKey.value.trim(),
      primaryModel: inputPrimaryModel.value.trim() || DEFAULT_CONFIG.primaryModel,
      fallbackModel: inputFallbackModel.value.trim() || DEFAULT_CONFIG.fallbackModel,
      customShortcut: inputCustomShortcut.value.trim(),
      autoReplace: checkAutoReplace.checked,
      systemPrompt: inputSystemPrompt.value.trim() || DEFAULT_CONFIG.systemPrompt
    };

    const success = await saveConfig(updates);
    showToast("✅ Settings saved successfully!");
  });

  // Reset to defaults
  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (confirm("Are you sure you want to restore default settings?")) {
      await saveConfig(DEFAULT_CONFIG);
      await loadFormValues();
      showToast("🔄 Restored to defaults!");
    }
  });

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 3000);
  }
});
