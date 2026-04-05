const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const { error } = require('console');

let DB_NAME = null;
const COLLECTION_NAME = 'users';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/khrypto';
const PORT = process.env.PORT || 8003;

const SALT_ROUNDS = 10;

const TOKEN_SERVICE_URL = process.env.GATEWAY_URL
  ? `${process.env.GATEWAY_URL}/api/sign`
  : 'http://127.0.0.1:8000/api/sign';

const client = new MongoClient(MONGO_URL);

let user_collection;

async function runGetStarted() {
  try {
    await client.connect();
    console.log("Successfully connected to MongoDB server");

    const khryto_db = client.db();
    user_collection = khryto_db.collection(COLLECTION_NAME);
    DB_NAME = khryto_db.databaseName;

    // Give 600 ELO to any existing user that doesn't have the field yet
    const updateResult = await user_collection.updateMany(
      { elo: { $exists: false } },
      { $set: { elo: 600 } }
    );

    if (updateResult.modifiedCount > 0) {
      console.log(`Successfully retrofitted ${updateResult.modifiedCount} existing users with default ELO.`);
    }

    const coinsUpdateResult = await user_collection.updateMany(
      { coins: { $exists: false } },
      { $set: { coins: 0 } }
    );

    if (coinsUpdateResult.modifiedCount > 0) {
      console.log(`Successfully retrofitted ${coinsUpdateResult.modifiedCount} existing users with default coins.`);
    }

    // Display initial database state
    await displayDatabaseInfo();

  } catch (error) {
    console.log(error);
  }
}

runGetStarted().catch(console.dir);

// Display database information with clear user formatting
async function displayDatabaseInfo() {
  try {
    const khryto_db = client.db();

    // 1. See all collections in the khrypto database
    const collections = await khryto_db.listCollections().toArray();
    console.log(`\n--- Collections in ${DB_NAME} ---`);
    console.log(collections.map(c => c.name));

    // 2. See all users in the collection with clear formatting
    const allUsers = await user_collection.find({}).toArray();
    console.log(`\n--- Content of ${COLLECTION_NAME} (${allUsers.length} users) ---`);
    if (allUsers.length > 0) {
      allUsers.forEach((user, index) => {
        console.log(`\nUser #${index + 1}:`);
        console.log(`  Username: ${user.username}`);
        console.log(`  Mail:     ${user.mail}`);
        console.log(`  Password: ${user.password}`);
        console.log(`  ELO:      ${user.elo}`);
        console.log(`  Coins:    ${user.coins}`);
      });
    } else {
      console.log("  No users found.");
    }
    console.log("");
  } catch (error) {
    console.error("Error displaying database info:", error);
  }
}

// Create a user with a valid mail format and check if the mail or username does not already exist
// Hash the password
async function createValidUser(username, mail, password) {
  const mail_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!mail_regex.test(mail)) {
    throw new Error("INVALID_MAIL_FORMAT");
  }

  const existingUserName = await user_collection.findOne({ username: username });
  if (existingUserName) {
    throw new Error("USERNAME_ALREADY_EXIST")
  }

  const existingMail = await user_collection.findOne({ mail: mail });
  if (existingMail) {
    throw new Error("MAIL_ALREADY_EXIST")
  }

  const hashed_password = await bcrypt.hash(password, SALT_ROUNDS);

  const newUser = {
    username: username,
    mail: mail,
    password: hashed_password,
    elo: 600,
    coins: 0
  };
  return newUser;
}

async function authenticateUser(identifier, password) {
  const user = await user_collection.findOne({
    $or: [
      { mail: identifier },
      { username: identifier }
    ]
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND")
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    throw new Error("INVALID_PASSWORD");
  }

  return user;
}



async function getTokens(userId) {
  const tokens_request = await fetch(TOKEN_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId })
  });

  if (!tokens_request.ok) {
    throw new Error("TOKEN_SERVICE_FAILED");
  }

  const tokens = await tokens_request.json();
  return tokens;
}

// --- INTERNAL API HELPERS ---
// Used by other services via Gateway.

http.createServer(async function (request, response) {
  console.log(`Received query for a auth: ${request.url}`);

  if (request.url === "/api/auth/login") {
    console.log("Login request received");

    request.on("data", async (data) => {
      try {
        const { identifier, password } = JSON.parse(data);

        const user = await authenticateUser(identifier, password);

        const tokens = await getTokens(user._id.toString());

        console.log(`Login success for: ${identifier} (ID: ${user._id})`);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }));

      } catch (error) {
        switch (error.message) {
          case "USER_NOT_FOUND":
          case "INVALID_PASSWORD":
            response.writeHead(401, { "Content-Type": "text/plain" });
            response.end("Error 401: Invalid credentials");
            break;

          default:
            console.error(error);
            response.writeHead(500);
            response.end(error.message);
        }
      }
    });
  }

  else if (request.url === "/api/auth/register") {
    console.log("Register request received");
    request.on("data", async (data) => {
      try {
        const { username, email, password } = JSON.parse(data);

        const newUser = await createValidUser(username, email, password);

        const result = await user_collection.insertOne(newUser);
        const userId = result.insertedId.toString();

        const tokens = await getTokens(userId);

        // Display updated database info
        await displayDatabaseInfo();

        response.writeHead(201, { "Content-Type": "application/json" });
        console.log(`Register success for: ${username} (ID: ${userId})`);
        response.end(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }));

      } catch (error) {
        const validationErrors = ["INVALID_MAIL_FORMAT", "USERNAME_ALREADY_EXIST", "MAIL_ALREADY_EXIST"];
        if (validationErrors.includes(error.message)) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end(`Error 400: ${error.message.replace(/_/g, ' ')}`);
        } else {
          response.writeHead(500);
          response.end(error.message);
        }
      }
    });
  }

  else if (request.url === "/api/profile") {
    if (request.method !== 'GET') {
      response.writeHead(405, { "Content-Type": "text/plain" });
      return response.end("Method Not Allowed");
    }

    try {
      const userIdStr = request.headers['x-user-id'];
      if (!userIdStr) {
        response.writeHead(401, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Unauthorized: Missing user ID" }));
      }

      console.log(`Profile request received for user ID: ${userIdStr}`);
      const user = await user_collection.findOne({ _id: new ObjectId(userIdStr) });

      if (!user) {
        response.writeHead(404, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "User not found" }));
      }

      // Return profile data (without sensitive info)
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        username: user.username,
        email: user.mail,
        elo: user.elo
      }));

    } catch (error) {
      console.error("Error fetching profile:", error);
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("Internal Server Error");
    }
  }

}).listen(PORT, () => console.log(`Auth service listening on port ${PORT}`));