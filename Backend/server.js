/**
 * Main server entry point
 * Sets up Express server and Socket.IO
 */

import express from 'express';
import http from 'http';
import cors from 'cors';
import { log } from 'console';
import { SERVER_CONFIG } from './config/constants.js';
import { setupSocketIO } from './socket/socketSetup.js';

// Initialize Express app
const app = express();
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO
const io = setupSocketIO(server);

// Start server
const PORT = SERVER_CONFIG.PORT;
server.listen(PORT, () => {
    log(`Server is running on port ${PORT}`);
});

// Export io for potential use in other modules
export { io };