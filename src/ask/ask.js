const params = new URLSearchParams(window.location.search);
const url = params.get('url');
const subdomain = params.get('subdomain');
const parent = params.get('parent');
const containerName = params.get('container');
const cookieStoreId = params.get('cookieStoreId');
const tabId = parseInt(params.get('tabId'), 10);

document.getElementById('subdomain').textContent = subdomain;
document.getElementById('parent').textContent = parent;
document.getElementById('containerName').textContent = containerName;

document.getElementById('yesBtn').addEventListener('click', async () => {
  // Add subdomain as a rule for this container
  await browser.runtime.sendMessage({
    type: 'addRule',
    domain: subdomain,
    containerName: containerName
  });

  // Navigate to the URL in the container
  await browser.runtime.sendMessage({
    type: 'navigateInContainer',
    tabId: tabId,
    url: url,
    cookieStoreId: cookieStoreId,
    useTempContainer: false
  });
});

document.getElementById('noBtn').addEventListener('click', async () => {
  // Add subdomain to exclusion list for this container
  await browser.runtime.sendMessage({
    type: 'addExclusion',
    cookieStoreId: cookieStoreId,
    domain: subdomain
  });

  // Navigate to the URL in a temp container
  await browser.runtime.sendMessage({
    type: 'navigateInContainer',
    tabId: tabId,
    url: url,
    cookieStoreId: cookieStoreId,
    useTempContainer: true
  });
});
