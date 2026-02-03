const http = require('http');

http.createServer(function (request, response) {
  console.log(`Received query for a auth: ${request.url}`);

  if (request.url === "/api/auth/login") {
    console.log("Login request received");
    request.on("data", (data) => {
      console.log(data.toString());
    });
  } else if (request.url === "/api/auth/register") {
    console.log("Register request received");
    request.on("data", (data) => {
      console.log(data.toString());
    });
  } 

}).listen(8003);