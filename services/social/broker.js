const { Server } = require('socket.io');
const { ObjectId } = require('mongodb');
const db = require('./db');
const { filterSwearWords } = require('./utils');

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

        // --- Global Chat ---
        socket.on('global-chat:send', async (data) => {
            try {
                const content = (data.content || '').trim();
                if (!content || content.length > 500) return;

                const users = db.getUsersCollection();
                const sender = await users.findOne({ _id: new ObjectId(userId) });
                if (!sender) return;

                const message = {
                    senderId: userId,
                    senderUsername: sender.username,
                    content: content,
                    createdAt: new Date()
                };

                const globalMessages = db.getGlobalMessagesCollection();
                const result = await globalMessages.insertOne(message);

                // Broadcast to ALL connected users (filter swear words before sending)
                io.emit('global-chat:receive', {
                    _id: result.insertedId,
                    ...message,
                    content: filterSwearWords(message.content)
                });
            } catch (err) {
                console.error('Error handling global chat message:', err);
            }
        });

        // --- Private Chat ---
        socket.on('private-chat:send', async (data) => {
            try {
                const { friendshipId, content } = data;
                const trimmedContent = (content || '').trim();

                if (!friendshipId || !trimmedContent || trimmedContent.length > 500) return;

                // Verify the friendship exists and user is part of it
                const friendships = db.getFriendshipsCollection();
                const friendship = await friendships.findOne({ _id: new ObjectId(friendshipId) });

                if (!friendship) return;
                if (friendship.status !== 'accepted') return;
                if (friendship.requesterId !== userId && friendship.receiverId !== userId) return;

                // Determine the receiver
                const receiverId = friendship.requesterId === userId ? friendship.receiverId : friendship.requesterId;

                // Get sender info
                const users = db.getUsersCollection();
                const sender = await users.findOne({ _id: new ObjectId(userId) });
                if (!sender) return;

                // Save message to DB
                const message = {
                    friendshipId: friendshipId,
                    senderId: userId,
                    senderUsername: sender.username,
                    receiverId: receiverId,
                    content: trimmedContent,
                    readStatus: false,
                    createdAt: new Date()
                };

                const privateMessages = db.getPrivateMessagesCollection();
                const result = await privateMessages.insertOne(message);

                // Send to receiver using dispatch (handles online/offline)
                await dispatch(receiverId, 'private-chat:receive', {
                    _id: result.insertedId,
                    ...message
                });

                // Echo back to sender for confirmation
                socket.emit('private-chat:receive', {
                    _id: result.insertedId,
                    ...message
                });
            } catch (err) {
                console.error('Error handling private chat message:', err);
            }
        });

        socket.on('private-chat:mark-read', async (data) => {
            try {
                const { friendshipId } = data;
                if (!friendshipId) return;

                // Verify the friendship exists and user is part of it
                const friendships = db.getFriendshipsCollection();
                const friendship = await friendships.findOne({ _id: new ObjectId(friendshipId) });

                if (!friendship) return;
                if (friendship.requesterId !== userId && friendship.receiverId !== userId) return;

                // Mark all messages in this conversation where current user is the receiver as read
                const privateMessages = db.getPrivateMessagesCollection();
                await privateMessages.updateMany(
                    {
                        friendshipId: friendshipId,
                        receiverId: userId,
                        readStatus: false
                    },
                    {
                        $set: { readStatus: true }
                    }
                );

                console.log(`Marked messages as read for user ${userId} in friendship ${friendshipId}`);
            } catch (err) {
                console.error('Error marking messages as read:', err);
            }
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