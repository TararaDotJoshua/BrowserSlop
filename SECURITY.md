# Security Policy

## Supported versions

The latest release is supported with security fixes.

## Reporting a vulnerability

Open a private security advisory in this repository. Do not include tokens, client secrets, or personal data in a public issue.

## Release checklist

- Run `npm run check` and `npm run package`.
- Inspect the generated ZIP and confirm it contains only the allowlisted extension files.
- Confirm no OAuth client IDs, client secrets, access tokens, refresh tokens, `.env` files, private keys, or browser profiles are present.
- Test onboarding from empty extension storage.
- Test Settings → Reset everything and the offline widget experience.
