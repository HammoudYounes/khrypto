const http = require('http');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');
const { error } = require('console');

const DB_NAME = 'khrypto';
const COLLECTION_NAME = 'users';
const MONGO_URL = 'mongodb://127.0.0.1:27017/khrypto';

const SALT_ROUNDS = 10;

const TOKEN_SERVICE_URL = 'http://127.0.0.1:8004/sign';

const client = new MongoClient(MONGO_URL);

let user_collection;

async function runGetStarted() {
  try {
    await client.connect();
    console.log("Successfully connected to MongoDB server");

    const khryto_db = client.db(DB_NAME);
    user_collection = khryto_db.collection(COLLECTION_NAME);

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
    const khryto_db = client.db(DB_NAME);

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
    password: hashed_password
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
}



async function getTokens() {
const tokens_request = await fetch(TOKEN_SERVICE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
  });

  if (!tokens_request.ok) {
    throw new Error("TOKEN_SERVICE_FAILED");
  }

  const tokens = await tokens_request.json();
  return tokens;
}


http.createServer(function (request, response) {
  console.log(`Received query for a auth: ${request.url}`);

  if (request.url === "/api/auth/login") {
    console.log("Login request received");

    request.on("data", async (data) => {
      try {
        const { identifier, password } = JSON.parse(data);

        await authenticateUser(identifier, password)

        const tokens = await getTokens();

        console.log(`Login success for: ${identifier}`);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({accessToken : tokens.accessToken, refreshToken : tokens.refreshToken}));

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

        await user_collection.insertOne(newUser);

        // Display updated database info
        await displayDatabaseInfo();

        const tokens = getTokens();

        response.writeHead(201, { "Content-Type": "application/json" });
        console.log("")
        console.log(tokens)
        response.end(JSON.stringify({accessToken : tokens.accessToken, refreshToken : tokens.refreshToken}));

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

}).listen(8003);