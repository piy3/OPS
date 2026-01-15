# Backend Project Structure

This document describes the modular architecture of the backend server.

## Directory Structure

```
Backend/
├── config/              # Configuration and constants
│   └── constants.js     # All application constants (room config, socket events, server config)
├── utils/               # Utility functions
│   └── roomUtils.js     # Helper functions for room operations
├── services/            # Business logic layer
│   └── RoomManager.js   # Room management service (singleton)
├── handlers/            # Socket event handlers
│   ├── roomHandlers.js  # Room-related socket events (create, join, leave)
│   ├── gameHandlers.js  # Game-related socket events (start, actions)
│   └── connectionHandlers.js # Connection/disconnection handlers
├── socket/              # Socket.IO setup
│   └── socketSetup.js   # Socket.IO server initialization
├── server.js            # Main entry point
└── package.json         # Dependencies
```

## Module Responsibilities

### `config/constants.js`
- **Purpose**: Centralized configuration and constants
- **Exports**:
  - `ROOM_CONFIG`: Room-related settings (max players, code length, etc.)
  - `ROOM_STATUS`: Room status constants
  - `SERVER_CONFIG`: Server configuration (port, CORS)
  - `SOCKET_EVENTS`: All socket event names (client and server)

### `utils/roomUtils.js`
- **Purpose**: Pure utility functions for room operations
- **Functions**:
  - `generateRoomCode(rooms)`: Generates unique room codes
  - `getRoomCodeForSocket(rooms, socketId)`: Finds room for a socket
  - `generateDefaultPlayerName(socketId)`: Creates default player name

### `services/RoomManager.js`
- **Purpose**: Business logic for room management
- **Pattern**: Singleton service
- **Methods**:
  - `createRoom(socketId, playerData)`: Create new room
  - `getRoom(roomCode)`: Get room by code
  - `validateJoinRoom(roomCode, socketId)`: Validate join request
  - `addPlayerToRoom(roomCode, socketId, playerName)`: Add player
  - `removePlayerFromRoom(roomCode, socketId)`: Remove player
  - `validateStartGame(roomCode, socketId)`: Validate start request
  - `startGame(roomCode)`: Start game in room
  - `getRoomCodeForSocket(socketId)`: Find room for socket

### `handlers/roomHandlers.js`
- **Purpose**: Socket event handlers for room operations
- **Events Handled**:
  - `create_room`: Create new room
  - `join_room`: Join existing room
  - `leave_room`: Leave current room
  - `get_room_info`: Get room information
- **Function**: `registerRoomHandlers(socket, io)`

### `handlers/gameHandlers.js`
- **Purpose**: Socket event handlers for game operations
- **Events Handled**:
  - `start_game`: Host starts the game
  - `game_action`: In-game actions/updates
- **Function**: `registerGameHandlers(socket, io)`

### `handlers/connectionHandlers.js`
- **Purpose**: Socket event handlers for connection lifecycle
- **Events Handled**:
  - `connection`: New socket connection
  - `disconnect`: Socket disconnection
- **Function**: `registerConnectionHandlers(socket, io)`

### `socket/socketSetup.js`
- **Purpose**: Socket.IO server initialization and configuration
- **Function**: `setupSocketIO(httpServer)`: Returns configured Socket.IO server
- **Responsibilities**:
  - Configure CORS
  - Register all event handlers
  - Return io instance

### `server.js`
- **Purpose**: Main application entry point
- **Responsibilities**:
  - Initialize Express app
  - Create HTTP server
  - Setup Socket.IO
  - Start server

## Data Flow

```
Client Request
    ↓
Socket Event
    ↓
Handler (handlers/)
    ↓
Service (services/)
    ↓
Utils (utils/) [if needed]
    ↓
Response via Socket.IO
```

## Benefits of This Structure

1. **Separation of Concerns**: Each module has a single, clear responsibility
2. **Reusability**: Services and utils can be reused across handlers
3. **Testability**: Each module can be tested independently
4. **Maintainability**: Easy to locate and modify specific functionality
5. **Scalability**: Easy to add new handlers, services, or utilities
6. **Readability**: Clear organization makes code easier to understand

## Adding New Features

### Adding a New Socket Event Handler

1. Create handler function in appropriate `handlers/` file
2. Register it in `socket/socketSetup.js`
3. Add event name to `config/constants.js` if needed

### Adding a New Service

1. Create new service file in `services/`
2. Export singleton instance
3. Import and use in handlers

### Adding New Constants

1. Add to appropriate section in `config/constants.js`
2. Import where needed

## Example: Adding a Chat Feature

1. **Add constants** (`config/constants.js`):
   ```javascript
   SOCKET_EVENTS.CLIENT.SEND_MESSAGE = 'send_message';
   SOCKET_EVENTS.SERVER.MESSAGE = 'message';
   ```

2. **Create handler** (`handlers/chatHandlers.js`):
   ```javascript
   export function registerChatHandlers(socket, io) {
       socket.on(SOCKET_EVENTS.CLIENT.SEND_MESSAGE, (data) => {
           // Handle chat message
       });
   }
   ```

3. **Register in** (`socket/socketSetup.js`):
   ```javascript
   import { registerChatHandlers } from '../handlers/chatHandlers.js';
   // ... in connection handler
   registerChatHandlers(socket, io);
   ```

## Dependencies Flow

```
server.js
  ├── socket/socketSetup.js
  │     ├── handlers/roomHandlers.js
  │     │     ├── services/RoomManager.js
  │     │     │     └── utils/roomUtils.js
  │     │     └── config/constants.js
  │     ├── handlers/gameHandlers.js
  │     │     ├── services/RoomManager.js
  │     │     └── config/constants.js
  │     └── handlers/connectionHandlers.js
  │           ├── services/RoomManager.js
  │           └── config/constants.js
  └── config/constants.js
```
