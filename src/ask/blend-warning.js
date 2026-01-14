const params = new URLSearchParams(window.location.search);
const domain = params.get('domain');
const cookieStoreId = params.get('cookieStoreId');
const fromPending = params.get('fromPending') === 'true';
const ruleDomain = params.get('ruleDomain');
const tabId = parseInt(params.get('tabId'), 10);

document.getElementById('blendDomain').textContent = domain;

document.getElementById('cancelBtn').addEventListener('click', () => {
  window.close();
});

document.getElementById('confirmBtn').addEventListener('click', async () => {
  const hideWarning = document.getElementById('hideBlendWarning').checked;

  if (hideWarning) {
    await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: true });
  }

  if (fromPending) {
    // Blending from pending requests
    const domainToBlend = ruleDomain || domain;
    await browser.runtime.sendMessage({
      type: 'addBlend',
      cookieStoreId: cookieStoreId,
      domain: domainToBlend
    });
    await browser.runtime.sendMessage({
      type: 'allowOnce',
      tabId: tabId,
      domain: domain
    });
  } else {
    // Adding blend from container detail view
    await browser.runtime.sendMessage({
      type: 'addBlend',
      cookieStoreId: cookieStoreId,
      domain: domain
    });
  }

  window.close();
});
