# BrowserSlop

BrowserSlop is a customizable Microsoft Edge and Chromium new-tab dashboard with liquid-glass widgets, animated backgrounds, focus tools, and optional Google Calendar, Google Tasks, and X integrations.

## Highlights

- First-run setup for theme and accent personalization
- Responsive drag-and-resize widget dashboard
- Light, dark, and automatic themes with eight accent colors
- Calendar, tasks, focus timer, notes, links, habits, weather, clocks, and more
- Optional Google Calendar and Tasks sync
- Optional X home timeline through a local loopback token-refresh broker
- Local-first settings, layout, and widget storage
- Motion effects using a local sensor bridge, device sensors, or pointer simulation

## Local development

BrowserSlop has no runtime package dependencies. Node.js 20+ is used for validation and building.

```powershell
npm run check
npm run build
```

Load the development build:

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository folder.
4. Open a new tab and complete the first-run setup.

To test first-run setup again, open BrowserSlop Settings and select **Reset everything**.

## Production package

```powershell
npm run package
```

This validates the source, creates an unpacked production build in `dist/BrowserSlop`, and writes `release/BrowserSlop-1.0.0.zip` for Edge Add-ons or the Chrome Web Store.

## Google sync setup

BrowserSlop connects directly from the extension to Google APIs. Each installation supplies its own OAuth client ID; no OAuth identifier or secret is bundled in the repository.

1. Load BrowserSlop and copy its extension ID from `edge://extensions`.
2. In Google Cloud Console, create a project and enable the Google Calendar API and Google Tasks API.
3. Configure an External OAuth consent screen and add your account as a test user if the app is still in testing.
4. Create a Web application OAuth client with redirect URI `https://YOUR_EXTENSION_ID.chromiumapp.org/`.
5. Paste the client ID into **Settings → Google sync**, then connect.

## X timeline setup

The X widget is optional and uses credentials supplied by the person installing the extension. Credentials remain in that browser's extension storage and are excluded from builds and source control.

1. Create a confidential OAuth 2.0 app in the X Developer Console with `tweet.read`, `users.read`, and, when available, `offline.access`.
2. Add `https://YOUR_EXTENSION_ID.chromiumapp.org/` as the callback URL.
3. Generate user access and refresh tokens in the X Developer Console.
4. Start the local refresh broker with `powershell -ExecutionPolicy Bypass -File .\Start-X-Broker.ps1`.
5. Enter the client ID, client secret, access token, and refresh token in **Settings → X timeline**.

Never commit credentials or include a profile containing credentials in a release archive.

## Privacy and security

See [PRIVACY.md](PRIVACY.md) for data handling and [SECURITY.md](SECURITY.md) for vulnerability reporting and release guidance.

## License

MIT. See [LICENSE](LICENSE).
