// popup.js - Logic for the popup UI

const REMOTE_TABS_STORAGE_KEY = 'syncedRemoteTabs';

function updateStatus(statusText, lastSyncTimestamp) {
  const statusDiv = document.getElementById('sync-status');
  const lastSyncDiv = document.getElementById('last-sync-time');
  const syncButton = document.getElementById('sync-now');

  statusDiv.textContent = statusText;
  statusDiv.className = '';

  if (statusText.startsWith('Error') || statusText.includes('failed')) {
    statusDiv.classList.add('status-error');
  } else if (statusText.includes('successful')) {
    statusDiv.classList.add('status-success');
  } else if (statusText === 'Syncing...') {
    statusDiv.classList.add('status-syncing');
  }

  if (lastSyncTimestamp) {
    const date = new Date(lastSyncTimestamp);
    lastSyncDiv.textContent = `Last sync: ${date.toLocaleString()}`;
  } else {
    lastSyncDiv.textContent = 'Last sync: Never';
  }

  syncButton.disabled = (statusText === 'Syncing...');
}

function updateConfigStatus(statusText, isError = false) {
  const configStatusDiv = document.getElementById('config-status');
  configStatusDiv.textContent = statusText;
  configStatusDiv.className = 'sub-status';
  if (isError) {
    configStatusDiv.classList.add('status-error');
  }
}

async function saveConfiguration() {
  const serverUrlInput = document.getElementById('server-url');
  const passphraseInput = document.getElementById('passphrase');
  const saveButton = document.getElementById('save-config');

  const serverUrl = serverUrlInput.value.trim();
  const passphrase = passphraseInput.value;

  if (!serverUrl) {
    updateConfigStatus('Server URL is required.', true);
    return;
  }
  if (!passphrase) {
    updateConfigStatus('Passphrase is required.', true);
    return;
  }

  saveButton.disabled = true;
  updateConfigStatus('Saving...');

  try {
    const response = await browser.runtime.sendMessage({
      command: "saveConfiguration",
      config: {
        serverUrl: serverUrl,
        passphrase: passphrase
      }
    });

    if (response && response.success) {
      updateConfigStatus('Configuration saved.');
      passphraseInput.value = '';
      requestAndUpdateStatus(); 
    } else {
      throw new Error(response?.error || 'Failed to save configuration in background.');
    }
  } catch (error) {
    console.error('Error saving configuration:', error);
    updateConfigStatus(`Error: ${error.message}`, true);
  } finally {
    saveButton.disabled = false;
  }
}

async function resetSync() {
  const serverUrlInput = document.getElementById('server-url');
  const passphraseInput = document.getElementById('passphrase');
  const resetButton = document.getElementById('reset-sync');
  const saveButton = document.getElementById('save-config');

  const serverUrl = serverUrlInput.value.trim();
  const passphrase = passphraseInput.value;

  if (!serverUrl || !passphrase) {
    updateConfigStatus('Server URL and Passphrase must be entered to reset.', true);
    return;
  }

  // Create and show a custom confirmation dialog
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  
  const dialog = document.createElement('div');
  dialog.className = 'confirm-dialog';

  const title = document.createElement('h3');
  title.textContent = 'Warning: Complete Reset';
  
  const message = document.createElement('p');
  message.innerHTML = "WARNING: This will COMPLETELY WIPE all data on the server and reset using this browser's local bookmarks/tabs.<br><br>" +
    "Other devices connected to this server will NOT be able to decrypt any data unless they are also reset using the EXACT same passphrase.";
  
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'dialog-buttons';

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'cancel-button';

  const confirmButton = document.createElement('button');
  confirmButton.textContent = 'Reset Everything';
  confirmButton.className = 'confirm-button';

  buttonContainer.appendChild(cancelButton);
  buttonContainer.appendChild(confirmButton);
  dialog.appendChild(title);
  dialog.appendChild(message);
  dialog.appendChild(buttonContainer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  return new Promise((resolve) => {
    confirmButton.addEventListener('click', () => {
      document.body.removeChild(overlay);
      proceedWithReset();
      resolve();
    });

    cancelButton.addEventListener('click', () => {
      document.body.removeChild(overlay);
      updateConfigStatus('Reset cancelled.');
      resolve();
    });
  });

  async function proceedWithReset() {
    resetButton.disabled = true;
    saveButton.disabled = true;
    updateConfigStatus('Resetting sync and overwriting server data...');

    try {
      const response = await browser.runtime.sendMessage({
        command: "resetAndOverwrite",
        config: { serverUrl: serverUrl, passphrase: passphrase }
      });

      if (response && response.success) {
        updateConfigStatus('Sync reset successfully. Server data overwritten.');
        passphraseInput.value = '';
        requestAndUpdateStatus();
      } else {
        throw new Error(response?.error || 'Failed to reset sync in background.');
      }
    } catch (error) {
      console.error('Error during reset sync process:', error);
      updateConfigStatus(`Reset Error: ${error.message}`, true);
    } finally {
      resetButton.disabled = false;
      saveButton.disabled = false;
    }
  }
}

function triggerSync() {
  const syncButton = document.getElementById('sync-now');
  syncButton.disabled = true;
  updateStatus('Syncing...');

  browser.runtime.sendMessage({ command: "syncNow" })
    .then(response => {
      requestAndUpdateStatus();
      loadAndDisplayRemoteTabs();
    })
    .catch(error => {
      updateStatus(`Error: ${error.message}`);
      syncButton.disabled = false;
    });
}

async function displayRemoteTabs(tabs) {
  const listDiv = document.getElementById('remote-tabs-list');
  listDiv.innerHTML = '';

  if (!tabs || tabs.length === 0) {
    listDiv.innerHTML = '<p>No remote tabs found.</p>';
    return;
  }

  let localTabs = [];
  try {
    localTabs = await browser.tabs.query({});
  } catch (error) {
    console.error('Error fetching local tabs:', error);
  }

  const localTabUrls = new Set(localTabs.map(tab => tab.url));

  const filteredTabs = tabs.filter(tab => {
    if (!tab.url || tab.url.startsWith('about:')) {
      return false;
    }
    return !localTabUrls.has(tab.url);
  });

  if (filteredTabs.length === 0) {
    listDiv.innerHTML = '<p>No unique remote tabs found.</p>';
    return;
  }

  const ul = document.createElement('ul');
  filteredTabs.forEach(tab => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = tab.title || tab.url;
    button.title = tab.url;
    button.dataset.url = tab.url;
    button.classList.add('remote-tab-button');
    li.appendChild(button);
    ul.appendChild(li);
  });
  listDiv.appendChild(ul);
}

async function loadAndDisplayRemoteTabs() {
  const listDiv = document.getElementById('remote-tabs-list');
  try {
    const browserIdData = await browser.storage.local.get('syncBrowserId');
    const currentBrowserId = browserIdData.syncBrowserId;
    
    const result = await browser.storage.local.get(REMOTE_TABS_STORAGE_KEY);
    const remoteTabs = result[REMOTE_TABS_STORAGE_KEY];
    
    if (!remoteTabs || remoteTabs.length === 0) {
      displayRemoteTabs([]);
      return;
    }
    
    const tabsFromOtherBrowsers = currentBrowserId ? 
      remoteTabs.filter(tab => tab.browserId !== currentBrowserId) : 
      remoteTabs;
    
    console.log(`Displaying ${tabsFromOtherBrowsers.length} tabs from other browsers`);
    displayRemoteTabs(tabsFromOtherBrowsers);
  } catch (error) {
    console.error('Error loading remote tabs:', error);
    listDiv.innerHTML = '<p>Error loading tabs.</p>';
  }
}

function handleTabListClick(event) {
  if (event.target && event.target.classList.contains('remote-tab-button')) {
    const urlToOpen = event.target.dataset.url;
    if (urlToOpen) {
      console.log('Sending openRemoteTab message for:', urlToOpen);
      browser.runtime.sendMessage({ command: "openRemoteTab", url: urlToOpen })
        .then(response => {
          if (response && response.success) {
            console.log('Successfully requested to open tab:', urlToOpen);
          } else {
            console.error('Failed to open tab:', response ? response.error : 'Unknown error');
            updateStatus(`Error opening tab: ${response?.error || 'Unknown'}`, null);
          }
        })
        .catch(error => {
          console.error('Error sending openRemoteTab message:', error);
          updateStatus(`Error: ${error.message}`, null);
        });
    }
  }
}

async function requestAndUpdateStatus() {
  try {
    const response = await browser.runtime.sendMessage({ command: "getStatus" });
    updateStatus(response.status || 'Ready.', response.lastSync);
  } catch (error) {
    updateStatus(`Error: ${error.message}`, null);
  }
}

async function loadCurrentConfig() {
  try {
    const result = await browser.storage.local.get('serverUrl');
    if (result.serverUrl) {
      document.getElementById('server-url').value = result.serverUrl;
    }
  } catch (error) {
    console.error('Error loading current server URL:', error);
    updateConfigStatus('Could not load current URL.', true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCurrentConfig();
  requestAndUpdateStatus();
  loadAndDisplayRemoteTabs();

  document.getElementById('save-config').addEventListener('click', saveConfiguration);
  document.getElementById('sync-now').addEventListener('click', triggerSync);
  document.getElementById('reset-sync').addEventListener('click', resetSync);
  document.getElementById('remote-tabs-list').addEventListener('click', handleTabListClick);
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === 'statusUpdate') {
      updateStatus(message.status, message.lastSync);
      if (message.status === 'Sync successful') {
        loadAndDisplayRemoteTabs();
      }
    }
    return false;
  });
}); 