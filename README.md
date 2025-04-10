# Syncius

Syncius is a Firefox browser extension that provides self-hosted, end-to-end encrypted synchronization for your browser data. Keep your bookmarks, tabs, and other data in sync across devices without relying on third-party cloud services.

![image](https://github.com/user-attachments/assets/eae8c633-9d1d-443e-9a24-390da840a2cf)


## Features

*   **Self-Hosted:** You control your data by running your own sync server.
*   **End-to-End Encrypted:** Data is encrypted locally before being sent to your server, ensuring only you can read it.
*   **Syncs:**
    *   Bookmarks
    *   Tabs
    *   Storage (used internally by the extension)

## TO-DO

* Implement better bookmark merging (currently does not delete bookmarks)
* Improve UI/UX
* Get Better Logo
* Fix bugs I'm sure are there

## Setup

Setting up Syncius involves two main parts: running the server and installing the extension in Firefox.

### 1. Setting up the Server

The sync server is required for the extension to function. You can find the server code in the `server/` directory.

**Requirements:**

*   [Bun](https://bun.sh/) OR [Docker](https://www.docker.com/)

**Running with Bun:**

1.  Navigate to the `server/` directory in your terminal.
2.  Install dependencies:
    ```bash
      bun install
    ```
3.  Run the server:
    ```bash
    bun run index.ts
    ```
4.  By default, the server will listen on `http://localhost:7732`.

**Running with Docker:**

1.  Make sure Docker and Docker Compose are installed.
2.  Navigate to the `server/` directory in your terminal.
3.  Build and run the container:
    ```bash
    docker-compose up --build -d
    ```
4.  This will also start the server on `http://localhost:7732`

### 2. Installing the Extension

You can install the Syncius extension in Firefox via [the releases page](https://github.com/0xGingi/syncius/releases)


**Building the extension**:

1.  Install `web-ext`:
    ```bash
    bun install --global web-ext
    ```
2.  Navigate to the root directory of this project in your terminal.
3.  Run the extension:
    ```bash
    web-ext build
    ```
