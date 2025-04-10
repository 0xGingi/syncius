# Syncius

Syncius is a Firefox browser extension that provides self-hosted, end-to-end encrypted synchronization for your browser data. Keep your bookmarks, tabs, and other data in sync across devices without relying on third-party cloud services.

## Features

*   **Self-Hosted:** You control your data by running your own sync server.
*   **End-to-End Encrypted:** Data is encrypted locally before being sent to your server, ensuring only you can read it.
*   **Syncs:**
    *   Bookmarks
    *   Tabs
    *   Storage (used internally by the extension)

## Setup

Setting up Syncius involves two main parts: running the server and installing the extension in Firefox.

### 1. Setting up the Server

The sync server is required for the extension to function. You can find the server code in the `server/` directory.

**Requirements:**

*   [Bun](https://bun.sh/) OR [Docker](https://www.docker.com/)

**Running with Bun:**

1.  Navigate to the `server/` directory in your terminal.
2.  Install dependencies (if necessary, though Bun typically handles this on run).
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
4.  This will also start the server, typically accessible on `http://localhost:7732` (check `docker-compose.yml` for specifics).

### 2. Installing the Extension

You can install the Syncius extension in Firefox via the releases page


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