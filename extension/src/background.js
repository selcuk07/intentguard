// IntentGuard Background Service Worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_POPUP') {
    chrome.action.openPopup();
  }
});

// Set badge text when active intents exist
chrome.runtime.onInstalled.addListener(() => {
  console.log('IntentGuard extension installed');
});
