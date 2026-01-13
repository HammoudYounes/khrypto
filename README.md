# PS8

## Requirements

Node.js is the only requirement.

## Install

- Clone the repository
- In each project inside `services/` run `npm install` to download all the dependencies.

Note: this command should be run again every time you install/delete a package (which should not happen a lot)

## Run

In each project, run `node index.js` so the server will start listening to requests.

---

## Architecture

In the `services/` folder you will find all the projects that makes your website. Each subfolder is a node.js project
that contains:
- A `package.json` (and potentially some `node_modules`)
- An `index.js` file which is an HTTP server able to received requests
- Some logic used for the service to work correctly


---

At the start of your project, there are 2 services:
- `gateway` which is the clients' entry point. It receives all the requests and then redirect them to the correct service.
- `files` which is used to serve files. It is where your front files will go

---

To create a new service:
- Create a new folder inside `services/`
- Run `npm init -y` inside the created folder
- Create an `index.js` containing an HTTP server (and listening to a new port)
- Add any logic you want

---

To call a service:

2 external packages are allowed to transfer a request:
- `http-proxy` allows you to easily transfer a request "as-is" to another HTTP Server (you have an example in the gateway service)
- `axios` to perform specific REST requests.

---

## Git WorkFlow & Commit Convention

### Git WorkFlow

- **main**: Main branch, must always be stable.
- **develop**: Development branch for the next milestone, branched from `main`.
- **feature/[TX.Y]text**: Branch for a new feature, branched from `develop`.
    - `TX.Y` is the task number associated with the feature on GitHub.
    - `text` is a short and indicative name for the feature.

**Workflow:**
1. To implement a new feature, create a branch `feature/[TX.Y]text` from `develop`.
2. Once implementation is finished, merge the feature into `develop` via a **Pull Request**.
3. When a milestone is finished, merge `develop` into `main` via a **Pull Request**.

### Commit Messages

Format: `type: commit message #n`

**Types:**
- `feat`: For adding a new feature
- `fix`: For a bug fix
- `style`: For CSS changes or any site style changes
- `refactor`: For code improvements without changing behavior
- `test`: For adding or updating tests
- `other`: For any other change that cannot be classified

**#n**: Corresponds to the associated task ID on GitHub.