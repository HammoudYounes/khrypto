const http = require('http');
const db = require('./db');

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
const server = http.createServer(async (request, response) => {
    console.log(`Received query for social service: ${request.url}`);

    // Set CORS headers if needed for frontend direct access, though typically
    // Gateway handles this. We add basic JSON response headers for APIs.
    response.setHeader('Content-Type', 'application/json');


    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    console.log(`[${method}] ${pathname}`);


    if (request.url === "/api/social/health") {
        response.writeHead(200);
        response.end(JSON.stringify({ status: "ok", service: "social" }));
        return;
    }

    try {
        const friendships = db.getFriendshipsCollection();
        const message_queue = db.getMessageQueueCollection();
        const users = db.getUsersCollection();

        // ---------------------------------------------------------
        // GET /api/friend/search?username=X
        // ---------------------------------------------------------
        if (pathname === "/api/friend/search" && method === 'GET') {
            const searchQuery = parsedUrl.query.username;
            if (!searchQuery) return sendResponse(res, 400, { error: "Username query parameter required" });

            // Find users matching the partial username, excluding the current user
            const results = await users.find({
                username: { $regex: searchQuery, $options: 'i' },
                _id: { $ne: new ObjectId(currentUserId) } // Assuming users._id is ObjectId
            }).project({ username: 1 }).limit(20).toArray();

            return sendResponse(res, 200, { users: results });
        }

        // ---------------------------------------------------------
        // POST /api/friend/invite
        // ---------------------------------------------------------
        if (pathname === "/api/friend/invite" && method === 'POST') {
            const body = await parseJSONBody(req);
            const { receiverUsername } = body;

            if (!receiverUsername) return sendResponse(res, 400, { error: "receiverUsername is required" });

            // Find the user they are trying to invite
            const receiver = await users.findOne({ username: receiverUsername });
            if (!receiver) return sendResponse(res, 404, { error: "User not found" });

            const receiverId = receiver._id.toString();
            if (currentUserId === receiverId) return sendResponse(res, 400, { error: "You cannot invite yourself" });

            try {
                // Insert pending friendship
                const friendshipDoc = {
                    requesterId: currentUserId,
                    receiverId: receiverId,
                    status: 'pending',
                    createdAt: new Date()
                };
                const insertResult = await friendships.insertOne(friendshipDoc);

                // Queue notification for offline broker
                await message_queue.insertOne({
                    recipientId: receiverId,
                    type: "friend:invitation",
                    referenceId: insertResult.insertedId,
                    delivered: false,
                    createdAt: new Date()
                });

                return sendResponse(res, 201, { message: "Invitation sent", friendshipId: insertResult.insertedId });
            } catch (err) {
                // Catch duplicate key error (Index 1)
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
            const { friendshipId, action } = body; // action: "accept" | "decline"

            if (!friendshipId || !['accept', 'decline'].includes(action)) {
                return sendResponse(res, 400, { error: "Valid friendshipId and action ('accept' or 'decline') required" });
            }

            const friendship = await friendships.findOne({ _id: new ObjectId(friendshipId) });
            
            if (!friendship) return sendResponse(res, 404, { error: "Friendship request not found" });
            if (friendship.receiverId !== currentUserId) return sendResponse(res, 403, { error: "Not authorized to respond to this request" });
            if (friendship.status !== 'pending') return sendResponse(res, 400, { error: "Request is no longer pending" });

            if (action === 'accept') {
                await friendships.updateOne({ _id: new ObjectId(friendshipId) }, { $set: { status: 'accepted', updatedAt: new Date() } });
                
                // Notify the original requester that their invite was accepted
                await message_queue.insertOne({
                    recipientId: friendship.requesterId,
                    type: "friend:accepted",
                    referenceId: new ObjectId(friendshipId),
                    delivered: false,
                    createdAt: new Date()
                });
                return sendResponse(res, 200, { message: "Friendship accepted" });
            } else if (action === 'decline') {
                await friendships.deleteOne({ _id: new ObjectId(friendshipId) });
                return sendResponse(res, 200, { message: "Friendship declined and removed" });
            }
        }

        // ---------------------------------------------------------
        // GET /api/friend/list
        // ---------------------------------------------------------
        if (pathname === "/api/friend/list" && method === 'GET') {
            // Find all accepted friendships where current user is either requester or receiver
            const friends = await friendships.find({
                status: 'accepted',
                $or: [{ requesterId: currentUserId }, { receiverId: currentUserId }]
            }).toArray();

            // Extract the IDs of the *other* person in the friendship
            const friendIds = friends.map(f => 
                f.requesterId === currentUserId ? new ObjectId(f.receiverId) : new ObjectId(f.requesterId)
            );

            // Fetch their usernames
            const friendUsers = await users.find({ _id: { $in: friendIds } }).project({ username: 1 }).toArray();

            return sendResponse(res, 200, { friends: friendUsers });
        }

        // ---------------------------------------------------------
        // GET /api/friend/pending
        // ---------------------------------------------------------
        if (pathname === "/api/friend/pending" && method === 'GET') {
            // Find all pending invites where current user is the RECEIVER
            const pendingRequests = await friendships.find({
                status: 'pending',
                receiverId: currentUserId
            }).toArray();

            const requesterIds = pendingRequests.map(f => new ObjectId(f.requesterId));
            const requesterUsers = await users.find({ _id: { $in: requesterIds } }).project({ username: 1 }).toArray();

            // Map the usernames back to the friendship ID so the frontend can easily hit the 'respond' endpoint
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

            const friendship = await friendships.findOne({ _id: new ObjectId(friendshipId) });
            if (!friendship) return sendResponse(res, 404, { error: "Friendship not found" });

            // Ensure the user deleting the friendship is actually part of it
            if (friendship.requesterId !== currentUserId && friendship.receiverId !== currentUserId) {
                return sendResponse(res, 403, { error: "Not authorized to delete this friendship" });
            }

            await friendships.deleteOne({ _id: new ObjectId(friendshipId) });

            // Optional: notify the other person that they were removed
            const otherUserId = friendship.requesterId === currentUserId ? friendship.receiverId : friendship.requesterId;
            await message_queue.insertOne({
                recipientId: otherUserId,
                type: "friend:removed",
                referenceId: new ObjectId(friendshipId), // Even though deleted, helps frontend identify which one
                delivered: false,
                createdAt: new Date()
            });

            return sendResponse(res, 200, { message: "Friendship removed" });
        }

        // Default 404 for unknown routes
        return sendResponse(res, 404, { error: "Route Not Found" });

    } catch (error) {
        console.error("Server Error:", error);
        return sendResponse(res, 500, { error: "Internal Server Error" });
    }

});

server.listen(PORT, () => {
    console.log(`Friend service listening on port ${PORT}`);
});
