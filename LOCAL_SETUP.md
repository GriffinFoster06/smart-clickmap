# Smart ClickMap local overlay

This repository now ships with a self-hostable overlay server that reproduces the Twitch extension behaviour without relying on Twitch hosting.

## Quick start

```bash
npm --prefix backend install
npm --prefix backend run local
```

The server reads its configuration from `backend/local-config.json`. By default it exposes the overlay at <http://localhost:4000/overlay/phummylw> and also sets up a page for DougDoug. You can edit the JSON file to add or remove streamers, change the Twitch channel that should load in the embed, and customise the hotkeys.

## Hotkeys

Hotkeys are processed by the running Node.js process:

- `resetHeatmap` — clears the heatmap for the active streamer. Default: `r`
- `nextStreamer` / `previousStreamer` — cycles the active streamer in the config file. Default: `]` / `[`.
- `switchToStreamer` — optional per-streamer overrides. The sample config binds `1` to `phummylw` and `2` to `dougdoug`.

You can change these bindings in `backend/local-config.json`. When the server starts it prints out a summary of the hotkeys that are currently active.

## Sharing the overlay

Every configured streamer gets its own URL under `/overlay/{streamerId}`. For example, if you add a streamer with the ID `streamername`, the overlay will be available at:

```
http://localhost:4000/overlay/streamername
```

Deploying the overlay on your own domain (for example, `overlay.phummylw.com`) only requires pointing the domain at the machine running `local-server.js`.

## Resetting the heatmap from OBS

The OBS browser source uses the same WebSocket API as the website overlay. When you press the reset hotkey locally it will broadcast the reset message to every connected client, including OBS.
