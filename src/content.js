// Content Script: manages selection detection, floating indicator, AI call orchestration, and text replacement

let activeContainer = null;
let currentSelectionTarget = null;
let customShortcutString = "";

// Load config shortcuts on script initialization
function initContentConfig() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(['customShortcut'], (items) => {
      if (items && items.customShortcut) {
        customShortcutString = items.customShortcut.trim().toLowerCase();
      }
    });
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.customShortcut) {
        customShortcutString = (changes.customShortcut.newValue || "").trim().toLowerCase();
      }
    });
  }
}
initContentConfig();

// Listen for custom shortcut presses directly in DOM
window.addEventListener('keydown', (e) => {
  if (!customShortcutString) return;
  const parts = customShortcutString.split('+').map(p => p.trim());
  const needsCtrl = parts.includes('ctrl') || parts.includes('control');
  const needsAlt = parts.includes('alt');
  const needsShift = parts.includes('shift');
  const needsMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
  const keyPart = parts.find(p => !['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'command'].includes(p));

  if (
    e.ctrlKey === needsCtrl &&
    e.altKey === needsAlt &&
    e.shiftKey === needsShift &&
    e.metaKey === needsMeta &&
    keyPart && e.key.toLowerCase() === keyPart
  ) {
    e.preventDefault();
    e.stopPropagation();
    performTranslitSelection();
  }
}, true);

// Listen for commands triggered via Chrome extension (Alt+Shift+T or context menu)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "PERFORM_TRANSLIT_SELECTION") {
      performTranslitSelection();
      sendResponse({ status: "ACK" });
    }
  });
}

/**
 * Main handler to detect selection and trigger transliteration
 */
async function performTranslitSelection() {
  removeActiveContainer();

  const selectionInfo = getSelectedTextAndCoordinates();
  if (!selectionInfo || !selectionInfo.text) {
    showFloatingToast("⚠️ Please select text first to restore script.", selectionInfo ? selectionInfo.rect : null, 2500);
    return;
  }

  currentSelectionTarget = selectionInfo.target;
  const rect = selectionInfo.rect;

  // Show loading badge above selection
  showLoadingBadge(rect, "✨ Identifying language & restoring...");

  let isCompleted = false;
  const loadingTimeout = setTimeout(() => {
    if (!isCompleted) {
      isCompleted = true;
      removeActiveContainer();
      showFloatingToast("⏱️ Request timed out after 15s. Both primary and fallback AI models were unresponsive.", rect, 4500);
    }
  }, 15000);

  // Send request to background service worker
  chrome.runtime.sendMessage({ action: "CALL_GEMINI_TRANSLIT", text: selectionInfo.text }, (response) => {
    if (isCompleted) return;
    isCompleted = true;
    clearTimeout(loadingTimeout);
    removeActiveContainer();

    if (chrome.runtime.lastError) {
      showFloatingToast(`❌ Extension Error: ${chrome.runtime.lastError.message}`, rect, 4000);
      return;
    }

    if (!response || !response.success) {
      showFloatingToast(`❌ AI Error: ${response ? response.error : "Unknown error"}`, rect, 4500);
      return;
    }

    const restoredText = response.restoredText;
    const modelUsed = response.modelUsed || "AI";

    // Replace text if target is editable input / textarea / contenteditable
    if (selectionInfo.isEditable) {
      const replaced = replaceSelectedTextInEditable(selectionInfo.target, selectionInfo.range, restoredText);
      if (replaced) {
        showFloatingToast(`✅ Restored script (${formatModelName(modelUsed)})`, rect, 2200);
        return;
      }
    }

    // Otherwise, or if replacement failed, show popover with copy button
    showResultPopover(rect, restoredText, modelUsed);
  });
}

/**
 * Extract selected text, bounding rect, and editable status
 */
function getSelectedTextAndCoordinates() {
  const activeEl = document.activeElement;

  // Check if active element is an input or textarea
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    const start = activeEl.selectionStart;
    const end = activeEl.selectionEnd;
    if (start !== null && end !== null && start !== end) {
      const text = activeEl.value.substring(start, end);
      const rect = activeEl.getBoundingClientRect();
      return {
        text: text,
        target: activeEl,
        isEditable: !activeEl.readOnly && !activeEl.disabled,
        rect: {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX + (rect.width / 4),
          bottom: rect.bottom + window.scrollY
        }
      };
    }
  }

  // Check standard window selection (contenteditable or static text)
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (text && text.trim()) {
      const rect = range.getBoundingClientRect();
      let isEditable = false;
      let targetNode = range.commonAncestorContainer;
      if (targetNode.nodeType === Node.TEXT_NODE) targetNode = targetNode.parentNode;
      if (targetNode && (targetNode.isContentEditable || targetNode.closest('[contenteditable="true"]'))) {
        isEditable = true;
      }
      return {
        text: text,
        target: targetNode,
        range: range,
        isEditable: isEditable,
        rect: {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          bottom: rect.bottom + window.scrollY
        }
      };
    }
  }

  return null;
}

/**
 * Replaces selected text inside editable inputs / textareas / contenteditable preserving framework events & undo
 */
function replaceSelectedTextInEditable(target, range, newText) {
  try {
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      target.focus();
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const executed = document.execCommand('insertText', false, newText);
      if (!executed) {
        // Fallback for React/Vue framework state inputs
        target.setRangeText(newText, start, end, 'select');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    } else if (range || (target && target.isContentEditable)) {
      if (range) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      const executed = document.execCommand('insertText', false, newText);
      if (!executed && range) {
        range.deleteContents();
        range.insertNode(document.createTextNode(newText));
      }
      return true;
    }
  } catch (err) {
    console.warn("[Content] Error during direct replacement:", err);
  }
  return false;
}

/**
 * Shows floating loading badge right above the text selection
 */
function showLoadingBadge(rect, message) {
  removeActiveContainer();
  const container = createFloatingContainer(rect);
  container.innerHTML = `
    <div class="ai-translit-floating-badge">
      <div class="ai-translit-spinner"></div>
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(container);
  activeContainer = container;
}

/**
 * Shows brief toast notification badge
 */
function showFloatingToast(message, rect, durationMs = 2500) {
  removeActiveContainer();
  const container = createFloatingContainer(rect || { top: window.scrollY + 80, left: window.innerWidth / 2 - 120 });
  container.innerHTML = `
    <div class="ai-translit-floating-badge">
      <span>${message}</span>
    </div>
  `;
  document.body.appendChild(container);
  activeContainer = container;

  setTimeout(() => {
    if (activeContainer === container) {
      removeActiveContainer();
    }
  }, durationMs);
}

/**
 * Shows popover with restored text and Copy to Clipboard action
 */
function showResultPopover(rect, restoredText, modelUsed) {
  removeActiveContainer();
  const container = createFloatingContainer(rect);
  container.innerHTML = `
    <div class="ai-translit-popover">
      <div class="ai-translit-popover-header">
        <span>✨ Restored Original Script</span>
        <span class="ai-translit-model-tag">${formatModelName(modelUsed)}</span>
      </div>
      <div class="ai-translit-popover-body">${escapeHTML(restoredText)}</div>
      <div class="ai-translit-popover-actions">
        <button class="ai-translit-btn ai-translit-btn-primary" id="translit-btn-copy">📋 Copy</button>
        <button class="ai-translit-btn ai-translit-btn-close" id="translit-btn-close">✕</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);
  activeContainer = container;

  const copyBtn = container.querySelector('#translit-btn-copy');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(restoredText).then(() => {
      copyBtn.innerHTML = "✅ Copied!";
      setTimeout(() => removeActiveContainer(), 1200);
    });
  });

  const closeBtn = container.querySelector('#translit-btn-close');
  closeBtn.addEventListener('click', () => removeActiveContainer());
}

/**
 * Helper: creates positioned container
 */
function createFloatingContainer(rect) {
  const div = document.createElement('div');
  div.className = 'ai-translit-container';
  const topPos = rect && typeof rect.top === 'number' ? Math.max(10, rect.top - 46) : window.scrollY + 60;
  const leftPos = rect && typeof rect.left === 'number' ? Math.max(10, Math.min(rect.left, window.innerWidth - 300)) : window.innerWidth / 2 - 150;
  div.style.top = `${topPos}px`;
  div.style.left = `${leftPos}px`;
  return div;
}

/**
 * Helper: cleans up floating container
 */
function removeActiveContainer() {
  if (activeContainer && activeContainer.parentNode) {
    activeContainer.parentNode.removeChild(activeContainer);
  }
  activeContainer = null;
}

function formatModelName(modelId) {
  if (!modelId) return "Gemini AI";
  if (modelId.includes("gemini-3.1-flash-lite")) return "Gemini 3.1 Flash Lite";
  if (modelId.includes("gemma-4-31b")) return "Gemma 4 31B (Fallback)";
  return modelId;
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
