// server/index.ts - Syncius Bun Server

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';

const port = 7732;
const dataDir = '/app/data';
const dataFilePath = '/app/data/sync_data.json';
const saltFilePath = '/app/data/sync_salt.txt';

function createCorsResponse(body: BodyInit | null | undefined, status: number = 200, contentType: string = 'application/json'): Response {
    return new Response(body, {
        status: status,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            ...(status !== 204 && contentType && { 'Content-Type': contentType })
        }
    });
}

console.log(`Syncius server starting on port ${port}...`);
console.log(`Data directory: ${dataDir}`);

Bun.serve({
    port: port,
    async fetch(req) {
        const url = new URL(req.url);

        if (req.method === 'OPTIONS') {
            return createCorsResponse(null, 204);
        }

        if (!existsSync(dataDir)) {
            try {
                mkdirSync(dataDir, { recursive: true });
                console.log(`  Created data directory ${dataDir}.`);
            } catch (mkdirError: any) {
                console.error(`  CRITICAL: Failed to create data directory ${dataDir}:`, mkdirError);
                return createCorsResponse(JSON.stringify({ error: 'Server setup error: Cannot create data directory' }), 500);
            }
        }

        // --- GET /sync/salt --- 
        if (req.method === 'GET' && url.pathname === '/sync/salt') {
            console.log(`GET /sync/salt request received`);
            if (!existsSync(saltFilePath)) {
                console.log('  Salt file not found, returning 404.');
                return createCorsResponse(JSON.stringify({ error: 'Salt not found' }), 404);
            }
            try {
                const saltContent = readFileSync(saltFilePath, 'utf-8');
                console.log('  Salt file found, returning content.');
                return createCorsResponse(JSON.stringify({ salt: saltContent }), 200);
            } catch (error: any) {
                console.error('  Error reading salt file:', error);
                return createCorsResponse(JSON.stringify({ error: 'Error reading salt' }), 500);
            }
        }

        // --- POST /sync/salt ---
        if (req.method === 'POST' && url.pathname === '/sync/salt') {
            console.log(`POST /sync/salt request received`);
            const forceOverwrite = url.searchParams.get('force') === 'true';

            if (!forceOverwrite && existsSync(saltFilePath)) {
                console.log('  Salt file already exists and force is false, returning 409 Conflict.');
                return createCorsResponse(JSON.stringify({ error: 'Salt already exists' }), 409);
            }
            try {
                const clientData = await req.json();
                const saltToStore = clientData.salt;
                if (!saltToStore || typeof saltToStore !== 'string') {
                     return createCorsResponse(JSON.stringify({ error: 'Invalid salt format in request' }), 400);
                }
                
                writeFileSync(saltFilePath, saltToStore, 'utf-8');
                console.log(`  Salt successfully written (overwrite: ${forceOverwrite}) to ${saltFilePath}`);
                return createCorsResponse(JSON.stringify({ success: true }), forceOverwrite ? 200 : 201); // OK if overwrite, Created if new
            } catch (error: any) {
                console.error('  Error processing POST /sync/salt request:', error);
                 if (error instanceof SyntaxError) {
                    return createCorsResponse(JSON.stringify({ error: 'Invalid JSON in request body' }), 400);
                 }
                return createCorsResponse(JSON.stringify({ error: 'Error saving salt' }), 500);
            }
        }

        // --- GET /sync/data --- 
        if (req.method === 'GET' && url.pathname === '/sync/data') {
            console.log(`GET /sync/data request received`);
            if (!existsSync(dataFilePath)) {
                console.log('  Data file not found, returning 404.');
                return createCorsResponse(JSON.stringify({ error: 'No data found' }), 404);
            }

            try {
                const fileContent = readFileSync(dataFilePath, 'utf-8');
                console.log('  Data file found, returning content.');
                return createCorsResponse(fileContent, 200);
            } catch (error: any) {
                console.error('  Error reading data file:', error);
                return createCorsResponse(JSON.stringify({ error: 'Error reading data' }), 500);
            }
        }

        // --- POST /sync/data ---
        if (req.method === 'POST' && url.pathname === '/sync/data') {
            console.log(`POST /sync/data request received`);
            try {
                const clientData = await req.json();
                const clientPayloadString = clientData.payload;

                if (!clientPayloadString || typeof clientPayloadString !== 'string') {
                    return createCorsResponse(JSON.stringify({ error: 'Invalid payload format' }), 400);
                }

                if (!existsSync(dataDir)) {
                    try {
                        mkdirSync(dataDir, { recursive: true });
                        console.log(`  Created data directory ${dataDir} inside container.`);
                    } catch (mkdirError: any) {
                        console.error(`  Failed to create data directory ${dataDir}:`, mkdirError);
                    }
                }

                const serverTimestamp = new Date().toISOString();
                const dataToStore = {
                    payload: clientPayloadString, 
                    lastModified: serverTimestamp
                };
                
                writeFileSync(dataFilePath, JSON.stringify(dataToStore, null, 2), 'utf-8');
                console.log(`  Data successfully written to ${dataFilePath} (Timestamp: ${serverTimestamp})`);
                return createCorsResponse(JSON.stringify({ success: true }), 200);

            } catch (error: any) {
                console.error('  Error processing POST request:', error);
                 if (error instanceof SyntaxError) {
                    return createCorsResponse(JSON.stringify({ error: 'Invalid JSON in request body' }), 400);
                 }
                return createCorsResponse(JSON.stringify({ error: 'Error saving data' }), 500);
            }
        }

        return createCorsResponse(JSON.stringify({ error: 'Not Found' }), 404);
    },
});

console.log(`Server listening on http://localhost:${port}`); 