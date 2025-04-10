async function saveConfiguration() {
    
    saveButton.disabled = true;
    updateConfigStatus('Saving...');

    try {
        let response;
        try {
             response = await browser.runtime.sendMessage({
                command: "saveConfiguration",
                config: { serverUrl: serverUrl, passphrase: passphrase }
            });
        } catch (messageError) {
             console.error('Error sending saveConfiguration message:', messageError);
             throw new Error(`Communication error: ${messageError.message}`);
        }

        if (response && response.success) {
            updateConfigStatus('Configuration saved.');
            passphraseInput.value = ''; 
            requestAndUpdateStatus(); 
        } else {
            throw new Error(response?.error || 'Failed to save configuration in background.');
        }
    } catch (error) {
        console.error('Error saving configuration process:', error);
        updateConfigStatus(`Error: ${error.message}`, true);
    } finally {
        saveButton.disabled = false;
    }
}

async function resetSync() {
    console.log('[DEBUG] resetSync function entered.');
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

    const confirmation = confirm(
        "WARNING: This will overwrite the data on the server using the currently entered passphrase and this browser\'s local bookmarks/tabs.\n\n" +
        "Other devices connected to this server will NOT be able to decrypt the new data unless they are also reset using the EXACT same passphrase.\n\n" +
        "Are you sure you want to proceed?"
    );

    if (!confirmation) {
        updateConfigStatus('Reset cancelled.');
        return;
    }

    resetButton.disabled = true;
    saveButton.disabled = true;
    updateConfigStatus('Resetting sync and overwriting server data...');
    console.log('[DEBUG] Sending resetAndOverwrite message...');

    try {
        let response;
        try {
            response = await browser.runtime.sendMessage({
                command: "resetAndOverwrite",
                config: { serverUrl: serverUrl, passphrase: passphrase }
            });
        } catch (messageError) {
            console.error('Error sending resetAndOverwrite message:', messageError);
            throw new Error(`Communication error: ${messageError.message}`);
        }

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

function triggerSync() {
    const syncButton = document.getElementById('sync-now');
    syncButton.disabled = true;
    updateStatus('Syncing...'); 

    (async () => {
        try {
            let response;
            try {
                response = await browser.runtime.sendMessage({ command: "syncNow" });
            } catch (messageError) {
                console.error('Error sending syncNow message:', messageError);
                throw new Error(`Communication error: ${messageError.message}`);
            }
            
            console.log('Sync message sent, re-requesting status...');
            await requestAndUpdateStatus(); 
            loadAndDisplayRemoteTabs(); 

        } catch (error) {
             console.error('Error during sync trigger process:', error);
             updateStatus(`Error: ${error.message}`);
             syncButton.disabled = false; 
        }
    })();
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOMContentLoaded - setting up listeners.');
    const syncButton = document.getElementById('sync-now');
    const configForm = document.getElementById('config-form');
    const resetButton = document.getElementById('reset-sync'); 

    if (resetButton) {
        console.log('[DEBUG] Adding click listener to reset-sync button.');
        resetButton.addEventListener('click', resetSync);
    } else {
        console.error('[DEBUG] Reset sync button not found!');
    }
}); 