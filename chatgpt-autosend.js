/* ============================================================
   BrowserSlop — ChatGPT prompt auto-submit
   Runs only for links created by the BrowserSlop new-tab search.
   ============================================================ */
"use strict";

const params = new URLSearchParams(location.search);
const prompt = params.get("prompt")?.trim();
const isBrowserSlopLaunch = params.get("browserslop_autosend") === "1";

if (isBrowserSlopLaunch && prompt) {
  let submitted = false;
  const deadline = Date.now() + 15000;

  const submitPrompt = () => {
    if (submitted || Date.now() > deadline) return false;

    const composer = document.querySelector('#prompt-textarea[contenteditable="true"]');
    const sendButton = document.querySelector(
      '#composer-submit-button:not([disabled]), [data-testid="send-button"]:not([disabled])'
    );

    // Wait until ChatGPT has consumed the URL prompt and enabled its composer.
    if (!composer || !sendButton || composer.innerText.trim() !== prompt) return false;

    submitted = true;
    params.delete("browserslop_autosend");
    const remainingQuery = params.toString();
    history.replaceState(null, "", `${location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}`);
    sendButton.click();
    return true;
  };

  const timer = setInterval(() => {
    if (submitPrompt() || Date.now() > deadline) clearInterval(timer);
  }, 100);
  submitPrompt();
}
