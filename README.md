# Smart Clickmap

This repository contains a small demo of the "Smart Click Map" extension.
It includes a Node.js backend and a static frontend for displaying the heatmap
overlay used on Twitch.

## Prerequisites

- **Node.js** (v18 or newer recommended)
- **npm** for installing dependencies

## Setup

1. Install backend dependencies:

   ```bash
   cd backend
   npm install
   ```

2. Configure environment variables as needed:

   - `PORT` – Port for the backend server (default `8080`)
   - `GRID_SIZE` – Size of the heatmap grid (default `100`)
   - `TWITCH_SECRET` – Twitch extension secret (base64-encoded)
   - `REDIS_URL` – Optional Redis instance for storing clicks

   Create a `.env` file in `backend/` or set these variables in your shell.

## Running the Backend

From the `backend` folder run:

```bash
npm start
```

This launches the Express server and WebSocket endpoints.

## Running the Frontend

The files in `frontend` are static and can be served with any HTTP server.
For example, using the built‑in `http-server` package:

```bash
npx http-server frontend
```

The frontend expects the backend to be running and accessible via the URL
specified in `frontend/config.js` and `frontend/script.js`.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
