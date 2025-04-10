// background.js - Core logic will go here

const SYNC_ALARM_NAME = 'syncius-periodic-sync';
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
const SALT_STORAGE_KEY = 'cryptoSalt';
const LAST_KNOWN_SERVER_TIMESTAMP_KEY = 'lastKnownServerTimestamp';

let syncState = {
    lastSync: null,
    status: 'Idle',
    serverUrl: null,
    encryptionKey: null
};

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function stringToArrayBuffer(str) {
    return new TextEncoder().encode(str).buffer;
}

function arrayBufferToString(buffer) {
    return new TextDecoder('utf-8').decode(buffer);
}

const PBKDF2_ITERATIONS = 100000;

async function deriveEncryptionKey(passphrase, salt) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        stringToArrayBuffer(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function fetchSaltFromServer() {
    if (!syncState.serverUrl) throw new Error('Cannot fetch salt: Server URL not configured.');
    const url = `${syncState.serverUrl.replace(/\/+$/, '')}/sync/salt`;
    console.log(`Attempting to fetch salt from: ${url}`);
    try {
        const response = await fetch(url, { method: 'GET', mode: 'cors', headers: { 'Accept': 'application/json' } });
        if (response.status === 404) {
            console.log('Salt not found on server (404).');
            return null;
        }
        if (!response.ok) {
            throw new Error(`Server error fetching salt: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.salt) {
            throw new Error('Invalid salt response from server.');
        }
        console.log('Successfully fetched salt from server.');
        return data.salt;
    } catch (error) {
        console.error('Error fetching salt from server:', error);
        throw error;
    }
}

async function uploadSaltToServer(saltBase64, force = false) {
    if (!syncState.serverUrl) throw new Error('Cannot upload salt: Server URL not configured.');
    let url = `${syncState.serverUrl.replace(/\/+$/, '')}/sync/salt`;
    if (force) {
        url += '?force=true';
    }
    console.log(`Attempting to upload salt to: ${url} (Force: ${force})`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ salt: saltBase64 })
        });
        if (!force && response.status === 409) { 
             console.log('Salt already exists on server (received 409).');
             return false;
        }
        if (!response.ok) {
            throw new Error(`Server error uploading salt: ${response.status} ${response.statusText}`);
        }
        console.log(`Successfully uploaded salt to server (Force: ${force}).`);
        return true;
    } catch (error) {
        console.error('Error uploading salt to server:', error);
        throw error;
    }
}

async function loadConfiguration() {
    console.log('Loading configuration...');
    syncState.encryptionKey = null;
    let saltToUse = null;
    let saltSource = 'unknown';
    
    try {
        let result = await browser.storage.local.get(['serverUrl', SALT_STORAGE_KEY]);
        syncState.serverUrl = result.serverUrl;
        const localSaltBase64 = result[SALT_STORAGE_KEY];

        if (!syncState.serverUrl) {
            console.warn('Server URL not configured. Cannot proceed with key derivation.');
            syncState.status = 'Configuration missing';
            sendStatusUpdateToPopup();
            return; 
        }
        
        let fetchedSaltBase64 = null;
        try {
            fetchedSaltBase64 = await fetchSaltFromServer();
        } catch (fetchError) {
            console.warn('Failed to fetch salt from server, will rely on local salt if available.', fetchError);
            if (!localSaltBase64) {
                 throw new Error('Failed to fetch salt and no local salt available.');
            }
        }

        if (fetchedSaltBase64) {
            saltToUse = base64ToBuffer(fetchedSaltBase64);
            saltSource = 'server';
            if (fetchedSaltBase64 !== localSaltBase64) {
                 console.log('Updating local salt to match server.');
                 await browser.storage.local.set({ [SALT_STORAGE_KEY]: fetchedSaltBase64 });
            }
        } else if (localSaltBase64) {
            console.log('Using locally stored salt.');
            saltToUse = base64ToBuffer(localSaltBase64);
            saltSource = 'local (server unavailable/no salt yet)';
            if (fetchedSaltBase64 === null) {
                 console.log('Server has no salt, attempting to upload local salt...');
                 const uploaded = await uploadSaltToServer(localSaltBase64);
                 if (!uploaded) {
                    console.log('Salt conflict during upload, re-fetching salt from server...');
                    fetchedSaltBase64 = await fetchSaltFromServer();
                    if (fetchedSaltBase64) {
                         saltToUse = base64ToBuffer(fetchedSaltBase64);
                         saltSource = 'server (after conflict)';
                         await browser.storage.local.set({ [SALT_STORAGE_KEY]: fetchedSaltBase64 });
                    } else {
                         throw new Error('Failed to resolve salt conflict: Could not fetch salt after 409.');
                    }
                 }
            }
        } else {
            console.log('No salt found locally or on server. Generating new salt...');
            const newSaltArray = crypto.getRandomValues(new Uint8Array(16));
            saltToUse = newSaltArray.buffer;
            const newSaltBase64 = bufferToBase64(saltToUse);
            saltSource = 'generated';
            
            await browser.storage.local.set({ [SALT_STORAGE_KEY]: newSaltBase64 });
            console.log('Saved newly generated salt locally.');
            
            const uploaded = await uploadSaltToServer(newSaltBase64);
            if (!uploaded) {
                 console.log('Salt conflict during initial upload, re-fetching salt from server...');
                 fetchedSaltBase64 = await fetchSaltFromServer();
                 if (fetchedSaltBase64) {
                      saltToUse = base64ToBuffer(fetchedSaltBase64);
                      saltSource = 'server (after conflict)';
                      await browser.storage.local.set({ [SALT_STORAGE_KEY]: fetchedSaltBase64 });
                 } else {
                      throw new Error('Failed to resolve salt conflict: Could not fetch salt after 409 on initial upload.');
                 }
            }
        }

        const storedData = await browser.storage.local.get(['passphrase', 'cryptoKeyJWK']);
        const passphrase = storedData.passphrase;
        const storedJwk = storedData.cryptoKeyJWK;

        if (passphrase && saltToUse) {
            console.log(`Deriving encryption key using salt from: ${saltSource}`);
            const derivedKey = await deriveEncryptionKey(passphrase, saltToUse);
            syncState.encryptionKey = derivedKey;
            console.log('Encryption key derived successfully.');
            
            try {
                const jwk = await crypto.subtle.exportKey('jwk', derivedKey);
                await browser.storage.local.set({ cryptoKeyJWK: jwk });
                console.log('Derived key exported and stored as JWK.');
            } catch (exportError) {
                console.error('Failed to export/store derived key:', exportError);
            }
            
            await browser.storage.local.remove('passphrase');
            console.log('Raw passphrase removed from storage.');
            
        } else if (storedJwk) {
            console.log('No passphrase found, attempting to load key from stored JWK...');
            try {
                syncState.encryptionKey = await crypto.subtle.importKey(
                    'jwk',
                    storedJwk,
                    { name: 'AES-GCM' },
                    true,
                    ['encrypt', 'decrypt']
                );
                console.log('Successfully imported encryption key from stored JWK.');
            } catch (importError) {
                console.error('Failed to import key from stored JWK:', importError);
                await browser.storage.local.remove('cryptoKeyJWK'); 
                syncState.status = 'Key import failed. Passphrase needed.';
                sendStatusUpdateToPopup();
                return; 
            }
        } else {
            console.warn('Encryption key is not available (no passphrase or stored key). Sync disabled until configured.');
            syncState.status = 'Passphrase needed'; 
            sendStatusUpdateToPopup();
            return;
        }
        
        console.log('Configuration loaded:', syncState.serverUrl ? 'Server URL set' : 'Server URL missing', syncState.encryptionKey ? 'Key available' : 'Key unavailable');
        sendStatusUpdateToPopup();

    } catch (error) {
        console.error('Error during configuration loading / salt handling:', error);
        syncState.status = `Error: ${error.message}`; 
        syncState.encryptionKey = null;
        sendStatusUpdateToPopup();
    }
}

async function encryptData(data) {
    console.log('Encrypting data...');
    if (!syncState.encryptionKey) throw new Error('Encryption key not available.');

    const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes IV for AES-GCM is recommended
    const dataString = JSON.stringify(data);
    const encodedData = stringToArrayBuffer(dataString);

    const encryptedContent = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv
        },
        syncState.encryptionKey,
        encodedData
    );

    const combinedBuffer = new Uint8Array(iv.length + encryptedContent.byteLength);
    combinedBuffer.set(iv, 0);
    combinedBuffer.set(new Uint8Array(encryptedContent), iv.length);

    return bufferToBase64(combinedBuffer);
}

async function decryptData(encryptedBase64Data) {
    console.log('Decrypting data object...');
    if (!syncState.encryptionKey) throw new Error('Encryption key not available for decryption.');

    const combinedBuffer = base64ToBuffer(encryptedBase64Data);
    const iv = combinedBuffer.slice(0, 12);
    const encryptedContent = combinedBuffer.slice(12);

    try {
        const decryptedContent = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            syncState.encryptionKey,
            encryptedContent
        );

        const decryptedString = arrayBufferToString(decryptedContent);
        return JSON.parse(decryptedString);
    } catch (error) {
        console.error('Decryption failed:', error);
        throw new Error('Decryption failed. Check passphrase or data integrity.');
    }
}

async function fetchDataFromServer() {
    console.log('Fetching data and timestamp from server...');
    if (!syncState.serverUrl) throw new Error('Server URL not configured.');
    const url = `${syncState.serverUrl.replace(/\/+$/, '')}/sync/data`;
    console.log(`Fetching from: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log('No data found on server (404). Assuming initial sync.');
                return { payload: { bookmarks: [], tabs: [] }, lastModified: null }; // Return empty state
            }
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        const responseJson = await response.json();
        const encryptedData = responseJson.payload;
        const lastModified = responseJson.lastModified;

        if (!encryptedData) {
             console.warn('Received empty payload from server.');
             return { payload: { bookmarks: [], tabs: [] }, lastModified: lastModified || null };
        }

        console.log(`Received encrypted data (modified: ${lastModified}), decrypting...`);
        const decryptedPayload = await decryptData(encryptedData);
        return { payload: decryptedPayload, lastModified: lastModified };

    } catch (error) {
        console.error('Error fetching data from server:', error);
        throw new Error(`Network or fetch error: ${error.message}`);
    }
}

async function sendDataToServer(dataPayload) {
    console.log('Sending data payload to server...');
    if (!syncState.serverUrl) throw new Error('Server URL not configured.');
    const url = `${syncState.serverUrl.replace(/\/+$/, '')}/sync/data`;
    console.log(`Sending to: ${url}`);

    try {
        const newTimestamp = new Date().toISOString();
        const dataToSend = { 
            payload: dataPayload, 
            lastModified: newTimestamp 
        };
        
        const encryptedPayloadString = await encryptData(dataToSend); // Encrypt the whole object
        console.log(`Data encrypted (new timestamp: ${newTimestamp}), sending POST request...`);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: encryptedPayloadString }), // Send Base64 string in payload field
            mode: 'cors'
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        console.log('Data sent successfully to server.');
        return true;

    } catch (error) {
        console.error('Error sending data to server:', error);
        throw new Error(`Network or fetch error: ${error.message}`);
    }
}

function flattenBookmarkNodes(nodes) {
    let flatList = [];
    for (const node of nodes) {
        const bookmarkItem = {
            id: node.id,
            parentId: node.parentId,
            index: node.index,
            title: node.title,
            dateAdded: node.dateAdded,
            type: node.type,
        };
        if (node.url) {
            bookmarkItem.url = node.url;
        }
        if (node.type === 'folder' && node.dateGroupModified) {
            bookmarkItem.dateGroupModified = node.dateGroupModified;
        }
        
        flatList.push(bookmarkItem);

        if (node.children) {
            flatList = flatList.concat(flattenBookmarkNodes(node.children));
        }
    }
    return flatList;
}

async function getCurrentBrowserState() {
    console.log('Getting current browser state...');
    const tabs = await browser.tabs.query({}); 
    const bookmarkTreeNodes = await browser.bookmarks.getTree();

    let browserIdData = await browser.storage.local.get('syncBrowserId');
    let browserId = browserIdData.syncBrowserId;
    
    if (!browserId) {
        browserId = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await browser.storage.local.set({ syncBrowserId: browserId });
        console.log(`Created new browser ID: ${browserId}`);
    }

    const REMOTE_TABS_STORAGE_KEY = 'syncedRemoteTabs';
    const remoteTabsData = await browser.storage.local.get(REMOTE_TABS_STORAGE_KEY);
    const existingRemoteTabs = remoteTabsData[REMOTE_TABS_STORAGE_KEY] || [];
    
    const otherBrowsersTabs = existingRemoteTabs.filter(tab => {
        return tab.browserId && tab.browserId !== browserId;
    });

    const currentTabs = tabs.map(tab => ({
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        url: tab.url,
        title: tab.title,
        active: tab.active,
        pinned: tab.pinned,
        discarded: tab.discarded,
        browserId: browserId,
        lastUpdated: new Date().toISOString()
    }));

    const mergedTabs = [...currentTabs, ...otherBrowsersTabs];
    
    const currentBookmarks = flattenBookmarkNodes(bookmarkTreeNodes);

    console.log(`State captured: ${currentTabs.length} local tabs, ${otherBrowsersTabs.length} remote tabs from other browsers, ${currentBookmarks.length} bookmark nodes.`);
    return { tabs: mergedTabs, bookmarks: currentBookmarks };
}

async function applyServerStateToBrowser(serverState) {
    if (!serverState || !serverState.bookmarks) {
        console.warn('applyServerStateToBrowser: No server bookmark data received.');
        return;
    }
    console.log('Applying server bookmark state to browser...');
    const serverBookmarks = serverState.bookmarks;

    const localTree = await browser.bookmarks.getTree();
    const localBookmarks = flattenBookmarkNodes(localTree); 
    const localMapById = localBookmarks.reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});
    const serverMapById = serverBookmarks.reduce((map, item) => {
        map[item.id] = item;
        return map;
    }, {});

    console.log(`Local bookmarks: ${localBookmarks.length}, Server bookmarks: ${serverBookmarks.length}`);

    const idsToDelete = Object.keys(localMapById).filter(id => !serverMapById[id]);
    const itemsToDelete = idsToDelete
        .map(id => localMapById[id])
        .filter(item => item.parentId); 

    console.log(`Found ${itemsToDelete.length} items to delete locally (Deletion currently disabled!).`);

    // 3. Apply Deletions [!] DISABLED TEMPORARILY TO PREVENT DATA LOSS [!]
    /* 
    // Separate folders and bookmarks/separators for careful deletion
    const foldersToDelete = itemsToDelete.filter(item => item.type === 'folder');
    const othersToDelete = itemsToDelete.filter(item => item.type !== 'folder');

    // Delete bookmarks and separators first
    for (const item of othersToDelete) {
        try {
            console.log(`Deleting non-folder item: ${item.title} (${item.id})`);
            await browser.bookmarks.remove(item.id);
        } catch (error) {
            console.warn(`Failed to delete item ${item.id} ('${item.title}'):`, error.message);
        }
    }

    // Delete folders (removeTree handles non-empty folders)
    for (const item of foldersToDelete) {
        try {
            console.log(`Deleting folder tree: ${item.title} (${item.id})`);
            await browser.bookmarks.removeTree(item.id);
        } catch (error) {
            console.warn(`Failed to delete folder tree ${item.id} ('${item.title}'):`, error.message);
        }
    }
    */
    console.warn('Bookmark deletion logic is currently disabled in applyServerStateToBrowser.');

    let createdIdMap = {};
    let processedServerIds = new Set();
    const maxPasses = 5;
    let changedInPass = true;

    console.log('Starting iterative creation/update/move process...');

    for (let pass = 1; pass <= maxPasses && changedInPass; pass++) {
        changedInPass = false;
        console.log(`--- Pass ${pass} ---`);

        const currentLocalTree = await browser.bookmarks.getTree();
        const currentLocalBookmarks = flattenBookmarkNodes(currentLocalTree);
        const currentLocalMapById = currentLocalBookmarks.reduce((map, item) => {
            map[item.id] = item;
            return map;
        }, {});

        for (const serverItem of serverBookmarks) {
            if (processedServerIds.has(serverItem.id)) {
                continue;
            }

            const targetParentId = createdIdMap[serverItem.parentId] || serverItem.parentId;
            const parentExistsLocally = !!currentLocalMapById[targetParentId] || targetParentId === '0' || targetParentId === null;

            let localItem = null;

            const mappedLocalId = createdIdMap[serverItem.id];
            if (mappedLocalId && currentLocalMapById[mappedLocalId]) {
                localItem = currentLocalMapById[mappedLocalId];
            }

            if (!localItem && parentExistsLocally) {
                localItem = currentLocalBookmarks.find(item => {
                    if (item.parentId !== targetParentId || item.type !== serverItem.type) {
                        return false;
                    }
                    if (item.type === 'bookmark') {
                        return item.title === serverItem.title && item.url === serverItem.url;
                    } else if (item.type === 'folder') {
                        return item.title === serverItem.title;
                    } else if (item.type === 'separator') {
                        return item.index === serverItem.index;
                    }
                    return false;
                });

                if (localItem) {
                     const conflictingServerId = Object.keys(createdIdMap).find(sId => createdIdMap[sId] === localItem.id);
                     if (conflictingServerId && conflictingServerId !== serverItem.id && processedServerIds.has(conflictingServerId)) {
                         console.warn(`Local item ${localItem.id} ('${localItem.title}') found by attributes, but it's already mapped to processed server ID ${conflictingServerId}. Skipping server item ${serverItem.id} to avoid potential conflict.`);
                         localItem = null;
                     }
                }
            }

            if (localItem) {
                if (!createdIdMap[serverItem.id]) {
                    createdIdMap[serverItem.id] = localItem.id;
                }

                let changes = {};
                let moveInfo = {};
                let needsUpdate = false;
                let needsMove = false;

                if (localItem.title !== serverItem.title) {
                    changes.title = serverItem.title;
                    needsUpdate = true;
                }
                if (localItem.type === 'bookmark' && localItem.url !== serverItem.url) {
                    changes.url = serverItem.url;
                    needsUpdate = true;
                }

                if (localItem.index !== serverItem.index) {
                    moveInfo.parentId = targetParentId;
                    moveInfo.index = serverItem.index;
                    needsMove = true;
                }

                try {
                    if (needsMove) {
                        await browser.bookmarks.move(localItem.id, moveInfo);
                        changedInPass = true;
                        localItem.parentId = targetParentId;
                        localItem.index = serverItem.index;
                    }
                    if (needsUpdate) {
                        await browser.bookmarks.update(localItem.id, changes);
                        changedInPass = true;
                        if(changes.title) localItem.title = changes.title;
                        if(changes.url) localItem.url = changes.url;
                    }

                    processedServerIds.add(serverItem.id);

                } catch (error) {
                    console.warn(`Failed to update/move item ${localItem.id} ('${localItem.title}') mapped from server ID ${serverItem.id}:`, error.message);
                    if (createdIdMap[serverItem.id] === localItem.id) {
                         delete createdIdMap[serverItem.id];
                    }
                }

            } else {
                if (!parentExistsLocally) {
                    console.warn(`Skipping creation for server item ${serverItem.id} ('${serverItem.title}'): Parent ${targetParentId} not found locally yet.`);
                    continue;
                }

                try {
                    const createProperties = {
                        parentId: targetParentId,
                        index: serverItem.index,
                        title: serverItem.title,
                        type: serverItem.type,
                    };
                    if (serverItem.type === 'bookmark') {
                        createProperties.url = serverItem.url;
                    }

                    const newItem = await browser.bookmarks.create(createProperties);
                    console.log(`   -> Created local item ${newItem.id} for server ID ${serverItem.id}`);
                    createdIdMap[serverItem.id] = newItem.id;
                    currentLocalMapById[newItem.id] = newItem;
                    processedServerIds.add(serverItem.id);
                    changedInPass = true;
                } catch (error) {
                    console.warn(`Failed to create item for server ID ${serverItem.id} ('${serverItem.title}'):`, error.message);
                }
            }
        }

        if (!changedInPass && processedServerIds.size < serverBookmarks.length) {
            console.warn(`Pass ${pass} finished with no changes, but ${serverBookmarks.length - processedServerIds.size} items remain unprocessed. Stopping.`);
            break;
        }
    }

    const unprocessedCount = serverBookmarks.length - processedServerIds.size;
    if (unprocessedCount > 0) {
        console.error(`Bookmark sync finished, but ${unprocessedCount} server items could not be processed.`);
    } else {
        console.log('Bookmark sync application completed successfully.');
    }
}

function sendStatusUpdateToPopup() {
  browser.runtime.sendMessage({
    command: 'statusUpdate',
    status: syncState.status,
    lastSync: syncState.lastSync
  }).catch(error => {
    if (!error.message.includes("Could not establish connection") && 
        !error.message.includes("Receiving end does not exist")) {
      console.error('Error sending status update:', error);
    }
  });
}

async function performSync(reason = 'periodic') {
    console.log(`Performing sync (${reason})...`);
    if (syncState.status === 'Syncing...') {
        console.log('Sync already in progress.');
        return;
    }
    if (!syncState.serverUrl || !syncState.encryptionKey) {
        syncState.status = 'Configuration missing';
        console.error('Cannot sync: Server URL or encryption key missing.');
        sendStatusUpdateToPopup();
        return;
    }

    syncState.status = 'Syncing...';
    sendStatusUpdateToPopup();
    const REMOTE_TABS_STORAGE_KEY = 'syncedRemoteTabs';
    let localTimestampData;

    try {
        localTimestampData = await browser.storage.local.get(LAST_KNOWN_SERVER_TIMESTAMP_KEY);
        const lastKnownServerTimestamp = localTimestampData ? localTimestampData[LAST_KNOWN_SERVER_TIMESTAMP_KEY] : null;
        console.log(`Last known server timestamp (local): ${lastKnownServerTimestamp}`);
        console.log('Step 1: Fetching remote state...');
        const fetchedData = await fetchDataFromServer();
        const remoteTimestamp = fetchedData.lastModified;
        const remoteData = fetchedData.payload;
        console.log(`Remote timestamp received: ${remoteTimestamp}`);

        let appliedChanges = false;
        if (remoteTimestamp && (!lastKnownServerTimestamp || new Date(remoteTimestamp) > new Date(lastKnownServerTimestamp))) {
            console.log('Remote state is newer or no local timestamp exists. Applying changes...');
            
            const actualPayload = remoteData?.payload; 
            
            console.log('Step 2a: Applying remote BOOKMARK state locally...');
            await applyServerStateToBrowser({ bookmarks: actualPayload?.bookmarks }); 
            
            console.log('Step 2b: Storing remote TAB state locally...');
            if (actualPayload && actualPayload.tabs && actualPayload.tabs.length > 0) {
                 try {
                     const currentTabsData = await browser.storage.local.get(REMOTE_TABS_STORAGE_KEY);
                     const currentTabs = currentTabsData[REMOTE_TABS_STORAGE_KEY] || [];
                     
                     console.log(`Storing ${actualPayload.tabs.length} remote tabs.`);
                     await browser.storage.local.set({ [REMOTE_TABS_STORAGE_KEY]: actualPayload.tabs });
                 } catch (storageError) { 
                      console.error('Error storing remote tabs locally:', storageError);
                 }
            } else {
                 console.log('No tabs found in remote payload, keeping existing tabs.');
            }
            
            await browser.storage.local.set({ [LAST_KNOWN_SERVER_TIMESTAMP_KEY]: remoteTimestamp });
            console.log(`Updated last known server timestamp locally to: ${remoteTimestamp}`);
            appliedChanges = true;
        } else {
             console.log('Local state is up-to-date or newer than server (or server has no timestamp). Skipping apply step.');
        }

        console.log('Step 3: Fetching current local state...');
        const currentLocalStatePayload = await getCurrentBrowserState();

        console.log('Step 4: Sending current local state to server...');
        await sendDataToServer(currentLocalStatePayload); 

        syncState.lastSync = new Date().toISOString();
        syncState.status = 'Sync successful';
        console.log('Sync completed successfully.');
        sendStatusUpdateToPopup();

    } catch (error) {
        console.error('Sync failed:', error);
        syncState.status = `Error: ${error.message}`;
        sendStatusUpdateToPopup();
    } finally {
        if (syncState.status === 'Syncing...') {
             syncState.status = 'Idle (after error/timeout)';
             sendStatusUpdateToPopup();
        }
    }
}

browser.runtime.onInstalled.addListener(async () => {
    console.log('Syncius extension installed/updated.');
    await loadConfiguration();
    await browser.alarms.create(SYNC_ALARM_NAME, {
        periodInMinutes: DEFAULT_SYNC_INTERVAL_MINUTES
    });
    console.log(`Periodic sync alarm '${SYNC_ALARM_NAME}' created.`);
    if (syncState.serverUrl && syncState.encryptionKey) {
        performSync('install/update');
    }
});

browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
        console.log('Periodic sync alarm triggered.');
        loadConfiguration().then(() => performSync('periodic'));
    }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[DEBUG] Background onMessage received:', request);
    console.log('Message received:', request);
    if (request.command === 'syncNow') {
        loadConfiguration().then(() => {
             performSync('manual').then(() => {
                 sendResponse({ status: syncState.status });
             }).catch(err => {
                 sendResponse({ status: syncState.status });
             });
        });
        return true;

    } else if (request.command === 'getStatus') {
        sendResponse({ status: syncState.status, lastSync: syncState.lastSync });
        return false;

    } else if (request.command === 'openRemoteTab') {
        if (request.url) {
            browser.tabs.create({ url: request.url, active: true })
                .then(tab => {
                    console.log(`Opened remote tab URL: ${request.url} in new tab ${tab.id}`);
                    sendResponse({ success: true });
                }, error => {
                    console.error(`Error opening remote tab URL ${request.url}:`, error);
                    sendResponse({ success: false, error: error.message });
                });
        } else {
            console.error('openRemoteTab command received without a URL');
            sendResponse({ success: false, error: 'No URL provided' });
        }
        return true;
        
    } else if (request.command === 'saveConfiguration') {
        const { serverUrl, passphrase } = request.config || {};
        if (!serverUrl || !passphrase) {
            sendResponse({ success: false, error: 'Missing serverUrl or passphrase in config object' });
            return false;
        }
        
        console.log(`Received saveConfiguration command. URL: ${serverUrl}, Passphrase: [present]`);
        
        browser.storage.local.set({ 
            serverUrl: serverUrl,
            passphrase: passphrase 
        }).then(async () => {
            console.log('Clearing potentially stale stored key before deriving new one...');
            await browser.storage.local.remove('cryptoKeyJWK'); // Ensure old key is gone if passphrase changed
            console.log('Temporary config saved, now calling loadConfiguration...');
            await loadConfiguration();
            console.log('loadConfiguration complete after save.');
            sendResponse({ success: true });
            
            sendStatusUpdateToPopup();
            
            if (syncState.serverUrl && syncState.encryptionKey) {
                console.log('Triggering sync after successful configuration save.');
                performSync('config change');
            }
            
        }).catch(error => {
            console.error('Error saving configuration or running loadConfiguration:', error);
            syncState.status = `Error: ${error.message}`;
            sendStatusUpdateToPopup();
            sendResponse({ success: false, error: error.message });
        });
        
        return true;

    } else if (request.command === 'resetAndOverwrite') {
        const { serverUrl, passphrase } = request.config || {};
        if (!serverUrl || !passphrase) {
            sendResponse({ success: false, error: 'Missing serverUrl or passphrase for reset' });
            return false;
        }

        console.warn(`Received resetAndOverwrite command. This will clear local crypto state and force upload.`);

        (async () => { 
            try {
                console.log('Clearing local crypto keys and timestamps...');
                syncState.encryptionKey = null; 
                await browser.storage.local.remove([
                    'cryptoKeyJWK', 
                    'cryptoSalt', 
                    'lastKnownServerTimestamp'
                ]);

                console.log('Generating new salt...');
                const newSaltArray = crypto.getRandomValues(new Uint8Array(16));
                const newSaltBuffer = newSaltArray.buffer;
                const newSaltBase64 = bufferToBase64(newSaltBuffer);
                
                console.log('Force-uploading new salt to server...');
                const saltUploaded = await uploadSaltToServer(newSaltBase64, true); // FORCE = true
                if (!saltUploaded) {
                    throw new Error('Failed to force-upload new salt to server.');
                }
                
                await browser.storage.local.set({ [SALT_STORAGE_KEY]: newSaltBase64 });
                console.log('Saved new salt locally.');

                console.log('Deriving and storing new key from provided passphrase and new salt...');
                const newKey = await deriveEncryptionKey(passphrase, newSaltBuffer);
                syncState.encryptionKey = newKey; 
                const newJwk = await crypto.subtle.exportKey('jwk', newKey);
                await browser.storage.local.set({ cryptoKeyJWK: newJwk });
                console.log('New key stored locally.');
                syncState.serverUrl = serverUrl;

                console.log('Fetching current local state to force upload...');
                const currentState = await getCurrentBrowserState();

                console.log('Encrypting local state with new key and uploading...');
                await sendDataToServer(currentState);
                syncState.lastSync = new Date().toISOString();
                const approxTimestamp = new Date().toISOString(); 
                await browser.storage.local.set({ [LAST_KNOWN_SERVER_TIMESTAMP_KEY]: approxTimestamp }); 

                syncState.status = 'Sync reset complete';
                console.log('Reset and overwrite successful.');
                sendStatusUpdateToPopup();
                sendResponse({ success: true });

            } catch (error) {
                console.error('Error during resetAndOverwrite process:', error);
                syncState.status = `Reset failed: ${error.message}`;
                syncState.encryptionKey = null; 
                sendStatusUpdateToPopup();
                sendResponse({ success: false, error: error.message });
            }
        })(); 
        return true;
    }

    console.log('Message not handled:', request.command);
    return false;
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.serverUrl || changes[SALT_STORAGE_KEY])) {
        const isLikelyFromSave = changes.passphrase;
        
        if (!isLikelyFromSave) {
             console.log('Configuration changed in storage (serverUrl or salt) externally, reloading...');
             loadConfiguration();
        } else {
            console.log('Ignoring storage change likely triggered by internal saveConfiguration flow.');
        }
    }
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            loadConfiguration().then(() => func.apply(this, ['auto', ...args]));
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const DEBOUNCE_SYNC_WAIT_MS = 5000; 
const debouncedPerformSync = debounce(performSync, DEBOUNCE_SYNC_WAIT_MS);

console.log('Setting up browser event listeners for automatic sync triggering...');

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        console.log(`Tab updated (${tabId}, change: ${Object.keys(changeInfo).join(', ')}), triggering debounced sync.`);
        debouncedPerformSync();
    }
});

browser.tabs.onCreated.addListener((tab) => {
    console.log(`Tab created (${tab.id}), triggering debounced sync.`);
    debouncedPerformSync();
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) {
        console.log(`Tab removed (${tabId}), triggering debounced sync.`);
        debouncedPerformSync();
    }
});

browser.bookmarks.onCreated.addListener((id, bookmark) => {
    console.log(`Bookmark created (${id}), triggering debounced sync.`);
    debouncedPerformSync();
});

browser.bookmarks.onRemoved.addListener((id, removeInfo) => {
    console.log(`Bookmark removed (${id}), triggering debounced sync.`);
    debouncedPerformSync();
});

browser.bookmarks.onChanged.addListener((id, changeInfo) => {
    console.log(`Bookmark changed (${id}), triggering debounced sync.`);
    debouncedPerformSync();
});

browser.bookmarks.onMoved.addListener((id, moveInfo) => {
    console.log(`Bookmark moved (${id}), triggering debounced sync.`);
    debouncedPerformSync();
});

loadConfiguration().then(() => {
    console.log('Initial configuration load complete.');
    browser.alarms.get(SYNC_ALARM_NAME).then(alarm => {
        if (!alarm) {
             console.log('Alarm not found on startup, recreating.');
             browser.alarms.create(SYNC_ALARM_NAME, {
                 periodInMinutes: DEFAULT_SYNC_INTERVAL_MINUTES
             });
        }
    });
});

console.log('Syncius background script loaded.'); 