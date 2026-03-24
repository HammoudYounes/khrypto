const http = require('http');
const url = require('url');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const db = require('./db');
const broker = require('./broker');

const PORT = process.env.PORT || 8006;
const ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:8002';
const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// In-memory store for pending challenges { challengeId -> { senderId, receiverId, mode, createdAt, timer } }
const pendingChallenges = new Map();

// Helper: Call Engine service to create a game
function callEngine(body) {
    return new Promise((resolve, reject) => {
        const engineUrl = new URL(ENGINE_URL);
        const jsonBody = JSON.stringify(body);
        const options = {
            hostname: engineUrl.hostname,
            port: engineUrl.port,
            path: '/api/games',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonBody)
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.gameId) resolve(parsed);
                    else reject(new Error('Engine did not return a gameId'));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(jsonBody);
        req.end();
    });
}

// Helper function to parse JSON body from raw HTTP requests
const parseJSONBody = (req) => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
    });
};

// Helper function to send JSON responses
const sendResponse = (res, statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

// Start the server
const server = http.createServer(async (req, res) => {
    console.log(`Received query for social service: ${req.url}`);

    // Assuming the API Gateway verifies Auth and passes the userId in the headers
    const currentUserId = req.headers['x-user-id'];

    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (!currentUserId && req.url !== "/social/health") {
        return sendResponse(res, 401, { error: "Unauthorized" });
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    console.log(`[${method}] ${pathname}`);

    if (req.url === "/social/health") {
        return sendResponse(res, 200, { status: "ok", service: "social" });
    }

    try {
        const friendships = db.getFriendshipsCollection();
        const users = db.getUsersCollection();

        // ---------------------------------------------------------
        // GET /api/chat/global?limit=15&offset=0
        // ---------------------------------------------------------
        if (pathname === "/api/chat/global" && method === 'GET') {
            const limit = Math.min(parseInt(parsedUrl.query.limit) || 15, 50);
            const offset = parseInt(parsedUrl.query.offset) || 0;

            const globalMessages = db.getGlobalMessagesCollection();
            const messages = await globalMessages
                .find({})
                .sort({ createdAt: -1 })
                .skip(offset)
                .limit(limit)
                .toArray();

            // Reverse so the array is chronological (oldest first)
            messages.reverse();

            return sendResponse(res, 200, { messages });
        }

        // ---------------------------------------------------------
        // GET /api/chat/private/unread/count
        // ---------------------------------------------------------
        if (pathname === "/api/chat/private/unread/count" && method === 'GET') {
            const privateMessages = db.getPrivateMessagesCollection();
            const unreadCounts = await privateMessages.aggregate([
                { $match: { receiverId: currentUserId, readStatus: false } },
                { $group: { _id: "$friendshipId", count: { $sum: 1 } } }
            ]).toArray();

            const result = {};
            unreadCounts.forEach(item => {
                result[item._id] = item.count;
            });

            return sendResponse(res, 200, { unread: result });
        }

        // ---------------------------------------------------------
        // GET /api/chat/private/:friendshipId?limit=15&offset=0
        // ---------------------------------------------------------
        if (pathname.startsWith("/api/chat/private/") && method === 'GET') {
            const friendshipId = pathname.split('/')[4];
            const limit = Math.min(parseInt(parsedUrl.query.limit) || 15, 50);
            const offset = parseInt(parsedUrl.query.offset) || 0;

            const friendship = await friendships.findOne({ _id: ObjectId.createFromHexString(friendshipId) });
            if (!friendship) {
                return sendResponse(res, 404, { error: "Friendship not found" });
            }
            if (friendship.requesterId !== currentUserId && friendship.receiverId !== currentUserId) {
                return sendResponse(res, 403, { error: "Not authorized to view this conversation" });
            }
            if (friendship.status !== 'accepted') {
                return sendResponse(res, 403, { error: "Can only message accepted friends" });
            }

            const privateMessages = db.getPrivateMessagesCollection();
            const messages = await privateMessages
                .find({ friendshipId: friendshipId })
                .sort({ createdAt: -1 })
                .skip(offset)
                .limit(limit)
                .toArray();

            // Reverse so the array is chronological (oldest first)
            messages.reverse();

            return sendResponse(res, 200, { messages });
        }

        // ---------------------------------------------------------
        // GET /api/friend/search?username=X
        // ---------------------------------------------------------
        if (pathname === "/api/friend/search" && method === 'GET') {
            const searchQuery = parsedUrl.query.username;
            if (!searchQuery) return sendResponse(res, 400, { error: "Username query parameter required" });

            // 1. Find all existing relationships (pending or accepted) involving the current user
            const existingLinks = await friendships.find({
                $or: [{ requesterId: currentUserId }, { receiverId: currentUserId }]
            }).toArray();

            // 2. Extract the IDs of the other users in those relationships
            const excludedUserIds = existingLinks.map(link =>
                link.requesterId === currentUserId ? link.receiverId : link.requesterId
            );

            // 3. Convert those string IDs to ObjectIds
            const excludedObjectIds = excludedUserIds.map(id => ObjectId.createFromHexString(id));

            // 4. Also exclude the current user from the search
            excludedObjectIds.push(ObjectId.createFromHexString(currentUserId));

            // 5. Search users, explicitly excluding the ObjectIds we just gathered using $nin
            const results = await users.find({
                username: { $regex: searchQuery, $options: 'i' },
                _id: { $nin: excludedObjectIds }
            }).project({ username: 1 }).limit(20).toArray();

            return sendResponse(res, 200, { users: results });
        }

        // ---------------------------------------------------------
        // POST /api/friend/invite
        // ---------------------------------------------------------
        if (pathname === "/api/friend/invite" && method === 'POST') {
            const body = await parseJSONBody(req);
            const receiverUsername = body.username
            if (!receiverUsername) return sendResponse(res, 400, { error: "receiverUsername is required" });

            const receiver = await users.findOne({ username: receiverUsername });
            if (!receiver) return sendResponse(res, 404, { error: "User not found" });

            const receiverId = receiver._id.toString();
            if (currentUserId === receiverId) return sendResponse(res, 400, { error: "You cannot invite yourself" });

            try {
                const friendshipDoc = {
                    requesterId: currentUserId,
                    receiverId: receiverId,
                    status: 'pending',
                    createdAt: new Date()
                };
                const insertResult = await friendships.insertOne(friendshipDoc);

                const requester = await users.findOne({ _id: ObjectId.createFromHexString(currentUserId) })

                // USE BROKER INSTEAD OF DIRECT DB INSERT
                await broker.dispatch(receiverId, "friend:invitation", {
                    referenceId: insertResult.insertedId,
                    senderId: currentUserId,
                    senderUsername: requester.username
                });

                return sendResponse(res, 201, { message: "Invitation sent", friendshipId: insertResult.insertedId });
            } catch (err) {
                if (err.code === 11000) {
                    return sendResponse(res, 409, { error: "Invitation already exists" });
                }
                throw err;
            }
        }

        // ---------------------------------------------------------
        // POST /api/friend/respond
        // ---------------------------------------------------------
        if (pathname === "/api/friend/respond" && method === 'POST') {
            const body = await parseJSONBody(req);
            const friendshipId = body.friendshipId;
            const action = body.action

            if (!friendshipId || !['accept', 'decline'].includes(action)) {
                return sendResponse(res, 400, { error: "Valid friendshipId and action ('accept' or 'decline') required" });
            }

            const friendship = await friendships.findOne({ _id: ObjectId.createFromHexString(friendshipId) });

            if (!friendship) return sendResponse(res, 404, { error: "Friendship request not found" });
            if (friendship.receiverId !== currentUserId) return sendResponse(res, 403, { error: "Not authorized to respond to this request" });
            if (friendship.status !== 'pending') return sendResponse(res, 400, { error: "Request is no longer pending" });

            const accepter = await users.findOne({ _id: ObjectId.createFromHexString(friendship.receiverId) })

            if (action === 'accept') {
                await friendships.updateOne({ _id: ObjectId.createFromHexString(friendshipId) }, { $set: { status: 'accepted', updatedAt: new Date() } });
                console.log(accepter.username)
                // USE BROKER INSTEAD OF DIRECT DB INSERT
                await broker.dispatch(friendship.requesterId, "friend:accepted", {
                    referenceId: ObjectId.createFromHexString(friendshipId),
                    senderId: friendship.receiverId,
                    senderUsername: accepter.username
                });

                return sendResponse(res, 200, { message: "Friendship accepted" });
            } else if (action === 'decline') {
                await friendships.deleteOne({ _id: ObjectId.createFromHexString(friendshipId) });

                await broker.dispatch(friendship.requesterId, "friend:declined", {
                    referenceId: ObjectId.createFromHexString(friendshipId),
                    senderId: friendship.receiverId,
                    senderUsername: accepter.username
                });
                return sendResponse(res, 200, { message: "Friendship declined and removed" });
            }
        }

        // ---------------------------------------------------------
        // GET /api/friend/list
        // ---------------------------------------------------------
        if (pathname === "/api/friend/list" && method === 'GET') {
            const friendDocs = await friendships.find({
                status: 'accepted',
                $or: [{ requesterId: currentUserId }, { receiverId: currentUserId }]
            }).toArray();

            const friendIds = friendDocs.map(f =>
                f.requesterId === currentUserId ? ObjectId.createFromHexString(f.receiverId) : ObjectId.createFromHexString(f.requesterId)
            );

            const friendUsers = await users.find({ _id: { $in: friendIds } }).project({ username: 1 }).toArray();

            // Zip friendshipId into each friend object
            const friendsWithMeta = friendUsers.map(user => {
                const doc = friendDocs.find(f => {
                    const otherId = f.requesterId === currentUserId ? f.receiverId : f.requesterId;
                    return otherId === user._id.toString();
                });
                return {
                    _id: user._id,
                    username: user.username,
                    friendshipId: doc ? doc._id : null
                };
            });

            return sendResponse(res, 200, { friends: friendsWithMeta });
        }

        // ---------------------------------------------------------
        // GET /api/friend/pending
        // ---------------------------------------------------------
        if (pathname === "/api/friend/pending" && method === 'GET') {
            const pendingRequests = await friendships.find({
                status: 'pending',
                receiverId: currentUserId
            }).toArray();

            const requesterIds = pendingRequests.map(f => ObjectId.createFromHexString(f.requesterId));
            const requesterUsers = await users.find({ _id: { $in: requesterIds } }).project({ username: 1 }).toArray();

            const responseData = pendingRequests.map(req => {
                const user = requesterUsers.find(u => u._id.toString() === req.requesterId);
                return {
                    friendshipId: req._id,
                    requesterId: req.requesterId,
                    requesterUsername: user ? user.username : "Unknown User",
                    createdAt: req.createdAt
                };
            });

            return sendResponse(res, 200, { pending: responseData });
        }

        // ---------------------------------------------------------
        // GET /api/friend/sent
        // ---------------------------------------------------------
        if (pathname === "/api/friend/sent" && method === 'GET') {
            const sentRequests = await friendships.find({
                status: 'pending',
                requesterId: currentUserId
            }).toArray();

            const receiverIds = sentRequests.map(f => ObjectId.createFromHexString(f.receiverId));
            const receiverUsers = await users.find({ _id: { $in: receiverIds } }).project({ username: 1 }).toArray();

            const responseData = sentRequests.map(req => {
                const user = receiverUsers.find(u => u._id.toString() === req.receiverId);
                return {
                    friendshipId: req._id,
                    receiverId: req.receiverId,
                    receiverUsername: user ? user.username : "Unknown User",
                    createdAt: req.createdAt
                };
            });

            return sendResponse(res, 200, { sent: responseData });
        }

        // ---------------------------------------------------------
        // DELETE /api/friend/:friendshipId
        // ---------------------------------------------------------
        const deleteMatch = pathname.match(/^\/api\/friend\/([0-9a-fA-F]{24})$/);
        if (deleteMatch && method === 'DELETE') {
            const friendshipId = deleteMatch[1];

            const friendship = await friendships.findOne({ _id: ObjectId.createFromHexString(friendshipId) });
            if (!friendship) return sendResponse(res, 404, { error: "Friendship not found" });

            if (friendship.requesterId !== currentUserId && friendship.receiverId !== currentUserId) {
                return sendResponse(res, 403, { error: "Not authorized to delete this friendship" });
            }

            // Delete the friendship
            await friendships.deleteOne({ _id: ObjectId.createFromHexString(friendshipId) });

            // Delete all private messages associated with this friendship
            const privateMessages = db.getPrivateMessagesCollection();
            const deleteResult = await privateMessages.deleteMany({ friendshipId: friendshipId });
            console.log(`Deleted ${deleteResult.deletedCount} private messages for friendship ${friendshipId}`);

            const otherUserId = friendship.requesterId === currentUserId ? friendship.receiverId : friendship.requesterId;

            // USE BROKER INSTEAD OF DIRECT DB INSERT
            await broker.dispatch(otherUserId, "friend:removed", {
                referenceId: ObjectId.createFromHexString(friendshipId)
            });

            return sendResponse(res, 200, { message: "Friendship removed" });
        }

        // ---------------------------------------------------------
        // GET /api/friend/challenge/pending
        // ---------------------------------------------------------
        if (pathname === "/api/friend/challenge/pending" && method === 'GET') {
            const received = [];
            const sent = [];
            for (const [challengeId, ch] of pendingChallenges) {
                if (ch.receiverId === currentUserId) {
                    received.push({ challengeId, senderId: ch.senderId, senderUsername: ch.senderUsername, mode: ch.mode, createdAt: ch.createdAt });
                }
                if (ch.senderId === currentUserId) {
                    sent.push({ challengeId, receiverId: ch.receiverId, mode: ch.mode, createdAt: ch.createdAt });
                }
            }
            return sendResponse(res, 200, { received, sent });
        }

        // ---------------------------------------------------------
        // POST /api/friend/challenge
        // ---------------------------------------------------------
        if (pathname === "/api/friend/challenge" && method === 'POST') {
            const body = await parseJSONBody(req);
            const { receiverId, mode } = body;

            if (!receiverId || !['ranked', 'unranked'].includes(mode)) {
                return sendResponse(res, 400, { error: "receiverId and mode ('ranked' or 'unranked') required" });
            }
            if (currentUserId === receiverId) {
                return sendResponse(res, 400, { error: "You cannot challenge yourself" });
            }

            // Validate friendship exists and is accepted
            const friendship = await friendships.findOne({
                status: 'accepted',
                $or: [
                    { requesterId: currentUserId, receiverId: receiverId },
                    { requesterId: receiverId, receiverId: currentUserId }
                ]
            });
            if (!friendship) {
                return sendResponse(res, 403, { error: "You can only challenge accepted friends" });
            }

            const challengeId = crypto.randomUUID();
            const sender = await users.findOne({ _id: ObjectId.createFromHexString(currentUserId) });

            // Store with TTL timer
            const timer = setTimeout(async () => {
                pendingChallenges.delete(challengeId);
                await broker.dispatch(currentUserId, 'challenge:expired', { challengeId });
            }, CHALLENGE_TTL_MS);

            pendingChallenges.set(challengeId, {
                senderId: currentUserId,
                senderUsername: sender.username,
                receiverId,
                mode,
                createdAt: Date.now(),
                timer
            });

            await broker.dispatch(receiverId, 'challenge:received', {
                challengeId,
                senderId: currentUserId,
                senderUsername: sender.username,
                mode
            });

            return sendResponse(res, 201, { message: "Challenge sent", challengeId });
        }

        // ---------------------------------------------------------
        // POST /api/friend/challenge/respond
        // ---------------------------------------------------------
        if (pathname === "/api/friend/challenge/respond" && method === 'POST') {
            const body = await parseJSONBody(req);
            const { challengeId, action } = body;

            if (!challengeId || !['accept', 'decline'].includes(action)) {
                return sendResponse(res, 400, { error: "challengeId and action ('accept' or 'decline') required" });
            }

            const challenge = pendingChallenges.get(challengeId);
            if (!challenge) {
                return sendResponse(res, 410, { error: "Challenge expired or not found" });
            }
            if (challenge.receiverId !== currentUserId) {
                return sendResponse(res, 403, { error: "Not authorized to respond to this challenge" });
            }

            // Check TTL
            if (Date.now() - challenge.createdAt > CHALLENGE_TTL_MS) {
                clearTimeout(challenge.timer);
                pendingChallenges.delete(challengeId);
                return sendResponse(res, 410, { error: "Challenge expired" });
            }

            // Clean up
            clearTimeout(challenge.timer);
            pendingChallenges.delete(challengeId);

            const responder = await users.findOne({ _id: ObjectId.createFromHexString(currentUserId) });

            if (action === 'decline') {
                await broker.dispatch(challenge.senderId, 'challenge:declined', {
                    challengeId,
                    responderUsername: responder.username
                });
                return sendResponse(res, 200, { message: "Challenge declined" });
            }

            // Accept: create game on Engine
            try {
                const senderUser = await users.findOne({ _id: ObjectId.createFromHexString(challenge.senderId) });
                const engineMode = challenge.mode === 'ranked' ? 'online' : 'online';
                const { gameId } = await callEngine({
                    mode: engineMode,
                    player1UserId: challenge.senderId,
                    player2UserId: currentUserId,
                    player1Elo: senderUser.elo || 600,
                    player2Elo: responder.elo || 600
                });

                const gameSessionData = {
                    gameId,
                    gameMode: challenge.mode,
                    challengeId,
                    // Challenger is player 0, responder is player 1
                    challenger: {
                        playerId: 0,
                        username: senderUser.username,
                        elo: senderUser.elo || 600
                    },
                    responder: {
                        playerId: 1,
                        username: responder.username,
                        elo: responder.elo || 600
                    }
                };

                // Notify the challenger to redirect
                await broker.dispatch(challenge.senderId, 'challenge:accepted', gameSessionData);

                // Return data to responder
                return sendResponse(res, 200, gameSessionData);
            } catch (err) {
                console.error("Failed to create game on Engine:", err);
                return sendResponse(res, 500, { error: "Failed to create game. Engine may be unavailable." });
            }
        }

        return sendResponse(res, 404, { error: "Route Not Found" });

    } catch (error) {
        console.error("Server Error:", error);
        return sendResponse(res, 500, { error: "Social Internal Server Error" });
    }

});

// Initialize Socket.io Broker alongside the HTTP server
broker.initBroker(server);

server.listen(PORT, () => {
    console.log(`Friend service listening on port ${PORT}`);
});