const { Server } = require('socket.io');
const { ObjectId } = require('mongodb');
const db = require('./db');

const onlineUsers = new Map(); // Map<userId, socket>
let io;

// Helper to broadcast status changes to a user's friends
async function broadcastFriendStatus(userId, isOnline) {
    try {
        const friendships = db.getFriendshipsCollection();

        const friends = await friendships.find({
            status: 'accepted',
            $or: [{ requesterId: userId }, { receiverId: userId }]
        }).toArray();

        friends.forEach(f => {
            const friendId = f.requesterId === userId ? f.receiverId : f.requesterId;
            const friendSocket = onlineUsers.get(friendId);

            if (friendSocket) {
                friendSocket.emit('friend:status-change', {
                    userId: userId,
                    status: isOnline ? 'online' : 'offline'
                });
            }
        });
    } catch (error) {
        console.error('Error broadcasting friend status:', error);
    }
}

function initBroker(server) {
    io = new Server(server, {
        path: '/social/socket.io',
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.use((socket, next) => {
        const token = socket.handshake.query.token;
        if (!token) return next(new Error("Authentication error: Token required"));

        const userId = socket.handshake.headers['x-user-id'];


        socket.userId = userId;
        next();
    });

    io.on('connection', async (socket) => {
        const userId = socket.userId;
        console.log(`User connected to broker: ${userId}`);

        // 1. Register user
        onlineUsers.set(userId, socket);

        // 2. Broadcast status
        await broadcastFriendStatus(userId, true);

        // 3. Flush queued messages (using the strict schema)
        try {
            const message_queue = db.getMessageQueueCollection();
            const queuedMessages = await message_queue.find({
                recipientId: userId,
                delivered: false
            }).toArray();

            if (queuedMessages.length > 0) {
                const messageIds = [];
                for (const msg of queuedMessages) {
                    // Reconstruct a payload for the frontend using the referenceId pointer

                    socket.emit(msg.type, msg.payload);
                    messageIds.push(msg._id);
                }

                // 4. Mark flushed messages as delivered
                await message_queue.updateMany(
                    { _id: { $in: messageIds } },
                    { $set: { delivered: true } }
                );
            }
        } catch (err) {
            console.error("Error flushing queued messages:", err);
        }

        // 4. Handle bulk online status request from frontend
        socket.on('friend:get-online-statuses', (data) => {
            const friendIds = data.friendIds || [];
            const onlineIds = friendIds.filter(id => onlineUsers.has(id));
            socket.emit('friend:online-statuses', { onlineIds });
        });

        socket.on('disconnect', async () => {
            console.log(`User disconnected from broker: ${userId}`);
            onlineUsers.delete(userId);
            await broadcastFriendStatus(userId, false);
        });
    });
}

// ---------------------------------------------------------
// REST API Dispatcher
// ---------------------------------------------------------
async function dispatch(recipientId, event, payload) {
    const socket = onlineUsers.get(recipientId);
    console.log(payload)
    if (socket) {
        // IF online -> emit full payload directly
        console.log(`${recipientId} is online`)
        socket.emit(event, payload);
    } else {
        // IF offline -> strictly insert the referenceId into the message_queue
        console.log(`${recipientId} is offline`)
        try {
            const message_queue = db.getMessageQueueCollection();

            // Ensure we safely cast the referenceId to an ObjectId if it exists
            await message_queue.insertOne({
                recipientId: recipientId,
                type: event,
                payload: payload,
                delivered: false,
                createdAt: new Date()
            });
        } catch (err) {
            console.error("Error queueing message for offline user:", err);
        }
    }
}

module.exports = {
    initBroker,
    dispatch
};