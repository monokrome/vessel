# Vessel

Automatic temporary containers with permanent container rules for Firefox and LibreWolf.

## Features

- **Automatic Isolation**: Unrecognized sites open in temporary containers that are cleaned up when closed
- **Permanent Containers**: Assign specific domains to named containers for persistent sessions
- **Subdomain Control**: Configure whether subdomains inherit parent domain rules (globally, per-container, or per-domain)
- **Request Blocking**: Third-party requests to domains belonging to other containers are blocked by default
- **Blending**: Allow controlled cross-container requests when needed (e.g., PayPal on Amazon)
- **Privacy-First**: Requests pause and wait for your decision rather than being silently allowed

## How It Works

1. **Default Behavior**: Any site without a rule opens in a temporary "Vessel" container
2. **Domain Rules**: Assign domains to specific containers (e.g., `amazon.com` → "Shopping")
3. **Request Handling**: When a page tries to load resources from another container's domain:
   - The request is paused
   - A badge appears on the Vessel icon showing pending requests
   - You decide: allow once, add to container, blend, or block

## Installation

### From Mozilla Add-ons (Recommended)
*Coming soon*

### Manual Installation
1. Download the latest `.xpi` from [Releases](https://github.com/monokrome/vessel/releases)
2. Open `about:addons` in Firefox/LibreWolf
3. Click the gear icon → "Install Add-on From File..."
4. Select the downloaded `.xpi` file

### Development
```bash
# Clone the repository
git clone https://github.com/monokrome/vessel.git
cd vessel

# Install dependencies
pnpm install

# Run tests
pnpm test

# Lint
pnpm lint

# Build
pnpm build

# Load in browser
# Open about:debugging#/runtime/this-firefox
# Click "Load Temporary Add-on" → select src/manifest.json
```

## Usage

### Page Action (Address Bar Icon)
Click the Vessel icon in the address bar to:
- Assign the current domain to a container
- View and manage pending third-party requests
- Create new containers

### Browser Action (Toolbar Icon)
Click the Vessel icon in the toolbar to:
- View all containers and their assigned domains
- Configure global subdomain settings
- Toggle blend warnings on/off

### Keyboard Shortcut
- `Alt+C`: Open the page action popup

## Permissions

Vessel requires these permissions to function:

| Permission | Purpose |
|------------|---------|
| `contextualIdentities` | Create and manage containers |
| `cookies` | Associate cookies with containers |
| `storage` | Save your domain rules and settings |
| `tabs` | Detect navigation and manage tab containers |
| `webNavigation` | Intercept navigation to apply container rules |
| `webRequest` | Monitor and pause third-party requests |
| `webRequestBlocking` | Block or allow requests based on rules |
| `<all_urls>` | Apply rules to any website |

## Privacy

Vessel is a privacy tool that keeps your data local:

- **No data collection**: Vessel does not collect, transmit, or share any user data
- **No analytics**: No tracking, telemetry, or usage statistics
- **No network requests**: Vessel never connects to external servers
- **Local storage only**: All settings and rules are stored locally in your browser

Your container rules, domain assignments, and preferences never leave your device.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
