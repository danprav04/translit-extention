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
    const result = await callModelAPI(config.apiKey, primaryModel, systemPrompt, inputText, 5000);
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
      const result = await callModelAPI(config.apiKey, fallbackModel, systemPrompt, inputText, 8000);
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
 * Executes HTTP POST request to Google's Generative Language API endpoint with strict timeout
 */
async function callModelAPI(apiKey, modelId, systemPrompt, inputText, timeoutMs = 6000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: `Restore and transliterate the following text to its original native language script.\nYou MUST enclose ONLY the final restored text inside <restored></restored> tags without any analysis, explanation, or notes:\n\n"${inputText}"\n\nOutput inside <restored></restored>:` }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

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

    return cleanModelOutput(resultText, inputText);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s (${modelId} did not respond in time)`);
    }
    throw err;
  }
}

/**
 * Sanitizes and extracts the exact restored phrase from any model output (Gemma/Gemini),
 * stripping away chain-of-thought analysis, bullet points, rule repetitions, and tags.
 */
function cleanModelOutput(rawText, originalInput) {
  if (!rawText) return "";
  let text = rawText.trim();

  // 1. Check for valid single-line/short <restored>...</restored> tags (taking the LAST occurrence if multiple)
  const tagMatches = [...text.matchAll(/<restored>([^<]*?)<\/restored>/gi)];
  if (tagMatches.length > 0) {
    for (let i = tagMatches.length - 1; i >= 0; i--) {
      const cand = tagMatches[i][1].trim();
      if (cand && !cand.includes("Rule") && !cand.includes("Input") && !cand.includes("*")) {
        return cand.replace(/^["']|["']$/g, '').trim();
      }
    }
  }

  // 1b. Check if <restored> was opened but never closed properly on the last lines
  const openTagMatches = [...text.matchAll(/<restored>\s*([^<\n\r]+)/gi)];
  if (openTagMatches.length > 0) {
    const lastCand = openTagMatches[openTagMatches.length - 1][1].trim();
    if (lastCand && !lastCand.includes("Rule") && !lastCand.includes("Input") && !lastCand.includes("*") && !lastCand.includes("tags")) {
      return lastCand.replace(/^["']|["']$/g, '').trim();
    }
  }

  // 2. Check for explicit "Result: ...", "Combined: ...", "Restored text: ..." lines
  const resultMatches = [...text.matchAll(/(?:Combined|Result|Restored|Final Output|Corrected|Restored text|Exact phrase):\s*["']?([^"'\n\r]+)["']?/gi)];
  if (resultMatches.length > 0) {
    const lastResult = resultMatches[resultMatches.length - 1][1].trim();
    if (lastResult && !lastResult.includes("Rule") && !lastResult.includes("Input") && !lastResult.includes("tags")) {
      return lastResult.replace(/^["']|["']$/g, '').trim();
    }
  }

  // 3. Multi-line chain of thought cleanup
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 1) {
    const origWordsCount = originalInput.trim().split(/\s+/).length;

    // Filter out standard chain-of-thought metadata and partial single-word breakdowns
    const contentLines = lines.filter(l => {
      if (/^\*?\s*(?:Input|Task|Analysis|Language|Target script|Constraint|Rule|Translation|Transliteration|Must be|Note|Explanation|Original|Combined|Result):/i.test(l)) return false;
      if (/enclosed in|<restored>|tags?|no explanation|no notes/i.test(l)) return false;
      // Check if this line is just a single word breakdown e.g. * "davai" -> "давай" when original input had multiple words
      if (origWordsCount > 1) {
        const arrowMatch = l.match(/["']?([^"'\n\r=]+)["']?\s*(?:->|=|=>)\s*["']?([^"'\n\r=]+)["']?/);
        if (arrowMatch) {
          const leftWords = arrowMatch[1].trim().split(/\s+/).length;
          if (leftWords < origWordsCount) return false; // skip partial word breakdown
        }
      }
      return true;
    });

    if (contentLines.length > 0) {
      let lastLine = contentLines[contentLines.length - 1];
      // Check if last line has full phrase arrow e.g. * "davai suda" -> "давай сюда" (Cyrillic Russian)
      const fullArrowMatch = lastLine.match(/(?:->|=>|=)\s*["']?([^"'\n\r()]+)["']?/);
      if (fullArrowMatch && fullArrowMatch[1].trim()) {
        lastLine = fullArrowMatch[1].trim();
      }

      // Clean leading bullet points / asterisks / numbers
      lastLine = lastLine.replace(/^\*+\s*/, '').replace(/^[0-9]+\.\s*/, '');
      // If last line has duplicated text like `"давай сюда"давай сюда`
      const dupMatch = lastLine.match(/^["']?([^"']+)["']\1$/) || lastLine.match(/^["']([^"']+)["']\s*\1$/);
      if (dupMatch) return dupMatch[1].trim();
      // If last line is wrapped in quotes
      lastLine = lastLine.replace(/^["']|["']$/g, '');
      return lastLine.trim();
    }
  }

  // Clean quotes/tags if single line
  text = text.replace(/<[^>]+>/g, '').replace(/^["']|["']$/g, '').trim();
  return text;
}
