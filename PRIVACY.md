# Privacy Policy for Vessel

**Last updated:** December 2024

## Overview

Vessel is a privacy-focused browser extension that helps isolate your browsing activity using Firefox's container feature. This privacy policy explains how Vessel handles your data.

## Data Collection

**Vessel does not collect any data.**

Specifically, Vessel:
- Does not collect personal information
- Does not collect browsing history
- Does not collect usage statistics or analytics
- Does not use telemetry
- Does not track users in any way
- Does not transmit any data to external servers

## Data Storage

Vessel stores the following data **locally in your browser** using the browser's built-in storage API:

- **Domain rules**: Which domains you've assigned to which containers
- **Container settings**: Subdomain preferences for each container
- **Global settings**: Your global preferences (e.g., subdomain handling, blend warning preferences)
- **Temporary container IDs**: Used to track and clean up temporary containers

This data:
- Never leaves your device
- Is not accessible to any external service
- Is not synchronized across devices (unless you use Firefox Sync, which is controlled by Mozilla)
- Can be deleted by removing the extension or clearing extension data

## Permissions Explanation

Vessel requests several permissions to function. Here's why each is needed:

| Permission | Why It's Needed |
|------------|-----------------|
| `contextualIdentities` | Required to create, read, and manage Firefox containers |
| `cookies` | Required to associate browsing sessions with specific containers |
| `storage` | Required to save your domain rules and preferences locally |
| `tabs` | Required to detect which container a tab is in and move tabs between containers |
| `webNavigation` | Required to intercept page loads and redirect to appropriate containers |
| `webRequest` | Required to monitor third-party requests and enforce container isolation |
| `webRequestBlocking` | Required to pause requests while waiting for user decisions |
| `<all_urls>` | Required to apply container rules to any website you visit |

## Third-Party Services

Vessel does not use any third-party services, APIs, or analytics platforms.

## Network Requests

Vessel makes **zero network requests**. The extension operates entirely offline and locally within your browser.

## Open Source

Vessel is open source software. You can review the complete source code at:
https://github.com/monokrome/vessel

## Changes to This Policy

If this privacy policy changes, the updated policy will be posted to the GitHub repository and the Mozilla Add-ons listing.

## Contact

For privacy concerns or questions, please open an issue at:
https://github.com/monokrome/vessel/issues

## Summary

**Vessel is designed to enhance your privacy, not compromise it.** The extension operates entirely locally, collects no data, and makes no network connections. Your browsing data and preferences stay on your device.
