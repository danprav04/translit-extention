import { getConfig } from '../config.js';

document.addEventListener('DOMContentLoaded', async () => {
  const config = await getConfig();

  // Display models
  const primaryDisplay = document.getElementById('model-primary-display');
  const fallbackDisplay = document.getElementById('model-fallback-display');
  const shortcutDisplay = document.getElementById('shortcut-display');

  if (primaryDisplay && config.primaryModel) {
    primaryDisplay.textContent = formatModelShortName(config.primaryModel);
  }
  if (fallbackDisplay && config.fallbackModel) {
    fallbackDisplay.textContent = formatModelShortName(config.fallbackModel);
  }

  // Display keyboard shortcut
  if (config.customShortcut) {
    shortcutDisplay.textContent = config.customShortcut.toUpperCase();
  } else if (typeof chrome !== 'undefined' && chrome.commands) {
    chrome.commands.getAll((commands) => {
      const translitCmd = commands.find(c => c.name === "translit-selection");
      if (translitCmd && translitCmd.shortcut) {
        shortcutDisplay.textContent = translitCmd.shortcut;
      } else {
        shortcutDisplay.textContent = "Alt + Shift + T";
      }
    });
  }

  // Open Options page
  document.getElementById('open-options').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  // Trigger on currently active tab
  document.getElementById('trigger-tab-translit').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "PERFORM_TRANSLIT_SELECTION" }, () => {
          window.close();
        });
      }
    });
  });

  // Quick scratchpad translation inside popup
  const quickInput = document.getElementById('quick-input');
  const quickBtn = document.getElementById('quick-translate-btn');
  const resultBox = document.getElementById('quick-result-box');
  const outputEl = document.getElementById('quick-output');
  const copyBtn = document.getElementById('quick-copy-btn');

  quickBtn.addEventListener('click', () => {
    const text = quickInput.value.trim();
    if (!text) return;

    quickBtn.disabled = true;
    quickBtn.textContent = "Restoring...";
    resultBox.classList.add('hidden');

    chrome.runtime.sendMessage({ action: "CALL_GEMINI_TRANSLIT", text: text }, (response) => {
      quickBtn.disabled = false;
      quickBtn.textContent = "Restore Script";

      if (response && response.success) {
        outputEl.textContent = response.restoredText;
        resultBox.classList.remove('hidden');
      } else {
        outputEl.textContent = `Error: ${response ? response.error : "Unknown error"}`;
        resultBox.classList.remove('hidden');
      }
    });
  });

  copyBtn.addEventListener('click', () => {
    const textToCopy = outputEl.textContent;
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => copyBtn.textContent = "Copy", 1500);
    });
  });

  // Link to shortcuts
  document.getElementById('link-shortcuts').addEventListener('click', (e) => {
    e.preventDefault();
    // Open Options page where full shortcut guidance and custom hotkeys live
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
});

function formatModelShortName(modelId) {
  if (modelId.includes("gemini-3.1-flash-lite")) return "Gemini 3.1 Flash Lite";
  if (modelId.includes("gemma-4-31b")) return "Gemma 4 31B";
  return modelId;
}
