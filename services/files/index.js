const http = require('http');

const fileQuery = require('./logic.js');

const PORT = process.env.PORT || 8001;

http.createServer(function (request, response) {
  console.log(`Received query for a file: ${request.url}`);
  fileQuery.manage(request, response);
}).listen(PORT, () => console.log(`Files service listening on port ${PORT}`));