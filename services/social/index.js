const http = require('http');
const url = require('url');
const { ObjectId } = require('mongodb');
const db = require('./db');
const broker = require('./broker');

const PORT = process.env.PORT || 8006;

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

                const requester = await users.findOne({_id: ObjectId.createFromHexString(currentUserId)})

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

            const accepter = await users.findOne({_id: ObjectId.createFromHexString(friendship.receiverId)})

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
            const friends = await friendships.find({
                status: 'accepted',
                $or: [{ requesterId: currentUserId }, { receiverId: currentUserId }]
            }).toArray();

            const friendIds = friends.map(f => 
                f.requesterId === currentUserId ? ObjectId.createFromHexString(f.receiverId) : ObjectId.createFromHexString(f.requesterId)
            );

            const friendUsers = await users.find({ _id: { $in: friendIds } }).project({ username: 1 }).toArray();

            return sendResponse(res, 200, { friends: friendUsers });
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
        // DELETE /api/friend/:friendshipId
        // ---------------------------------------------------------
        const deleteMatch = pathname.match(/^\/api\/friend\/([0-9a-fA-F]{24})$/);
        if (deleteMatch && method === 'DELETE') {
            const friendshipId = deleteMatch[1];

            const friendship = await friendships.findOne({ _id: new ObjectId.createFromHexString(friendshipId) });
            if (!friendship) return sendResponse(res, 404, { error: "Friendship not found" });

            if (friendship.requesterId !== currentUserId && friendship.receiverId !== currentUserId) {
                return sendResponse(res, 403, { error: "Not authorized to delete this friendship" });
            }

            await friendships.deleteOne({ _id: new ObjectId.createFromHexString(friendshipId) });

            const otherUserId = friendship.requesterId === currentUserId ? friendship.receiverId : friendship.requesterId;
            
            // USE BROKER INSTEAD OF DIRECT DB INSERT
            await broker.dispatch(otherUserId, "friend:removed", {
                referenceId: new ObjectId.createFromHexString(friendshipId)
            });

            return sendResponse(res, 200, { message: "Friendship removed" });
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