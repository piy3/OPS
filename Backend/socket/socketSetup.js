/**
 * Socket.IO server setup and configuration
 */

import { Server } from 'socket.io';
import { SERVER_CONFIG } from '../config/constants.js';
import { registerRoomHandlers } from '../handlers/roomHandlers.js';
import { registerGameHandlers } from '../handlers/gameHandlers.js';
import { registerConnectionHandlers } from '../handlers/connectionHandlers.js';

/**
 * Initialize and configure Socket.IO server
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {Server} Configured Socket.IO server instance
 */
export function setupSocketIO(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: SERVER_CONFIG.CORS_ORIGIN,
            methods: SERVER_CONFIG.CORS_METHODS
        }
    });

    // Register socket connection handler
    io.on('connection', (socket) => {
        // Register all event handlers
        registerConnectionHandlers(socket, io);
        registerRoomHandlers(socket, io);
        registerGameHandlers(socket, io);
    });

    return io;
}
