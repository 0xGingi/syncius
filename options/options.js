// options.js - Logic for saving/loading options

function saveOptions(e) {
  e.preventDefault();
  const serverUrl = document.getElementById('server-url').value;
  const passphrase = document.getElementById('passphrase').value;
  const status = document.getElementById('status');

  browser.storage.local.set({
    serverUrl: serverUrl,
    passphrase: passphrase
  }).then(() => {
    status.textContent = 'Options saved.';
    setTimeout(() => { status.textContent = ''; }, 1500);
  }, (error) => {
    status.textContent = `Error saving options: ${error}`;
  });
}

function restoreOptions() {
  function setCurrentChoice(result) {
    document.getElementById('server-url').value = result.serverUrl || '';
  }

  function onError(error) {
    console.log(`Error loading options: ${error}`);
  }

  let getting = browser.storage.local.get(["serverUrl"]);
  getting.then(setCurrentChoice, onError);
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('options-form').addEventListener('submit', saveOptions); 