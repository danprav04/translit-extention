import { getConfig } from './config.js';

// Setup Context Menu on install / startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translit-selection-menu",
    title: "✨ Transliterate & Restore Original Script",
    contexts: ["selection", "editable"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translit-selection-menu" && tab && tab.id) {
    triggerTranslitOnTab(tab.id);
  }
});

// Handle Chrome Command Keybinds (e.g. Alt+Shift+T)
chrome.commands.onCommand.addListener((command) => {
  if (command === "translit-selection") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        triggerTranslitOnTab(tabs[0].id);
      }
    });
  }
});

/**
 * Sends command to content script to perform transliteration on currently selected text
 */
function triggerTranslitOnTab(tabId) {
  chrome.tabs.sendMessage(tabId, { action: "PERFORM_TRANSLIT_SELECTION" }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("[Background] Could not send message to tab:", chrome.runtime.lastError.message);
      // Try injecting content script dynamically if not present yet on active tab
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
      }, () => {
        if (!chrome.runtime.lastError) {
          chrome.tabs.sendMessage(tabId, { action: "PERFORM_TRANSLIT_SELECTION" });
        }
      });
    }
  });
}

// Listen for messages from content scripts, options page, or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CALL_GEMINI_TRANSLIT") {
    handleTranslitRequest(request.text)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true; // Keep message channel open for async response
  }
});

/**
 * Calls Google AI REST API with primary model (`Gemini 3.1 Flash Lite`) and fallback (`Gemma 4 31B`)
 */
async function handleTranslitRequest(inputText) {
  if (!inputText || !inputText.trim()) {
    return { success: false, error: "No text provided for transliteration." };
  }

  const config = await getConfig();
  if (!config.apiKey) {
    return { success: false, error: "Gemini API Key is missing. Please set your API key in the extension Options." };
  }

  const primaryModel = config.primaryModel || "gemini-3.1-flash-lite-preview";
  const fallbackModel = config.fallbackModel || "gemma-4-31b-it";
  const systemPrompt = config.systemPrompt;

  // Try Primary Model
  try {
    console.log(`[Background] Attempting translit with Primary Model: ${primaryModel}`);
    const result = await callModelAPI(config.apiKey, primaryModel, systemPrompt, inputText);
    return {
      success: true,
      restoredText: result,
      modelUsed: primaryModel
    };
  } catch (primaryErr) {
    console.warn(`[Background] Primary model (${primaryModel}) failed:`, primaryErr.message);
    console.log(`[Background] Falling back to Secondary Model: ${fallbackModel}`);

    // Try Fallback Model
    try {
      const result = await callModelAPI(config.apiKey, fallbackModel, systemPrompt, inputText);
      return {
        success: true,
        restoredText: result,
        modelUsed: fallbackModel
      };
    } catch (fallbackErr) {
      console.error(`[Background] Fallback model (${fallbackModel}) also failed:`, fallbackErr.message);
      throw new Error(`Both models failed. Primary error: ${primaryErr.message}. Fallback error: ${fallbackErr.message}`);
    }
  }
}

/**
 * Executes HTTP POST request to Google's Generative Language API endpoint
 */
async function callModelAPI(apiKey, modelId, systemPrompt, inputText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: `Restore and transliterate the following text to its original native language script:\n\n${inputText}` }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errorJson = await response.json();
      if (errorJson.error && errorJson.error.message) {
        errorDetail = errorJson.error.message;
      }
    } catch (_) {}
    throw new Error(`API Error (${response.status}): ${errorDetail}`);
  }

  const data = await response.json();
  if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts) {
    throw new Error("Received empty response from AI model.");
  }

  const resultText = data.candidates[0].content.parts
    .map(part => part.text || "")
    .join("")
    .trim();

  return resultText;
}
