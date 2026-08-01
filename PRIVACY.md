# BrowserSlop Privacy Notice

BrowserSlop stores dashboard settings, layout, widget data, and optional integration credentials in browser extension storage on the device.

When a person enables an integration, BrowserSlop communicates directly with that provider:

- Google Calendar and Google Tasks for calendar and task data
- X for the home timeline
- Google Search or ChatGPT when the person submits a search to that destination
- A loopback service on `127.0.0.1` when the optional X refresh broker is running

BrowserSlop does not include an analytics service, advertising SDK, or first-party backend. It does not sell personal information. Removing the extension clears its browser-managed extension storage; **Reset everything** clears BrowserSlop's local application state.

Provider services process data under their own terms and privacy policies. Do not distribute a browser profile or release archive containing personal credentials.
