# Companion Module: Meld Studio

This is a [Bitfocus Companion](https://bitfocus.io/companion) module to control [Meld Studio](https://meldstudio.com) using its **Qt WebChannel** API.

## Features

- Connects directly to Meld Studio via WebSocket / WebChannel.
- Actions:
  - Change scenes.
  - Trigger/toggle both recording and streaming.
- Feedback:
  - Button background color updates when a scene is active (default red `#CC0000`).
- Presets:
  - Drag-and-drop prebuilt buttons for each available scene.

## Requirements

- Companion v4.0 or later.
- Meld Studio running with WebChannel enabled.
- Default WebChannel port: **13376** (can be customized in module config).

## Configuration

1. Add the module in Companion (`Meld Studio`).
2. Set the **Host** (IP or `127.0.0.1` if local).
3. Set the **Port** (default `13376`).
4. Save & test the connection.

## Usage

- After configuring, your available scenes will appear in the **Actions** dropdown.
- Drag presets from the **Presets tab** to your Companion surface.
- Active scenes will highlight in **red** by default.

## Known Limitations

- Currently limited to scene switching and active scene feedback.
- Additional feedback/actions (e.g., transitions, media control) may be added in future versions.

## Installation (Development)

```bash
git clone https://github.com/calmasacow/companion-module-meld-studio.git
cd companion-module-meld-studio
yarn install
yarn build
