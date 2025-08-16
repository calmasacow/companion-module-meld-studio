# Changelog

All notable changes to this project will be documented in this file.  
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2025-08-15
### Added
- Initial public release of the **Meld Studio Companion Module**.
- Ability to connect to **Meld Studio** via Qt WebChannel (WebSocket).
- **Scene switching** action: allows Companion buttons to trigger a change of scene inside Meld Studio.
- **Feedback**: active scene button highlights with a red background (`#CC0000`) when the scene is live.
- **Presets**: automatic generation of drag-and-drop buttons for all scenes discovered in Meld Studio.
- Configurable connection settings (host, port).
- Trigger-Toggle recording and streaming

### Notes
- This release focuses on **scene control and feedback**.  
- Future updates may include parameter control, timeline triggers, or multi-scene state awareness.
