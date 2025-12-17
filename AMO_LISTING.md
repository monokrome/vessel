# Mozilla Add-ons Listing Content

Use this content when submitting to addons.mozilla.org

---

## Summary (250 characters max)

Automatic container isolation for privacy. Unvisited sites open in temporary containers; assign domains to permanent containers. Blocks cross-container tracking requests.

---

## Description

### What is Vessel?

Vessel automatically isolates your browsing using Firefox containers. Sites you haven't configured open in temporary containers that disappear when closed. Sites you visit regularly can be assigned to permanent containers.

### Key Features

**Automatic Isolation**
Every new site opens in a temporary container by default. When you close the tab, the container and its cookies are deleted. No tracking cookies persist between sessions.

**Permanent Containers**
Assign domains to named containers for sites where you need persistent sessions. For example, keep Amazon in a "Shopping" container and Google in a "Work" container.

**Cross-Container Protection**
When a page tries to load resources from a domain that belongs to a different container, Vessel blocks the request and asks what you want to do. This prevents tracking networks from following you across container boundaries.

**Subdomain Control**
Configure whether subdomains automatically inherit their parent domain's container. Set this globally, per-container, or per-domain.

**Blending**
Sometimes you need cross-container communication (like using PayPal on Amazon). Vessel lets you "blend" specific domains, allowing controlled exceptions to container isolation.

### How to Use

1. Browse normally - new sites automatically use temporary containers
2. Click the Vessel icon in the address bar to assign the current site to a container
3. When third-party requests are blocked, a badge appears - click to review and decide
4. Use the toolbar icon to manage containers and global settings

### Privacy

Vessel collects no data, makes no network requests, and stores everything locally. Your rules and settings never leave your device. See our full privacy policy on GitHub.

---

## Categories

- Privacy & Security

---

## Tags

containers, privacy, isolation, temporary containers, tracking protection, cookie isolation

---

## Support Email

(Use your preferred contact email)

---

## Support URL

https://github.com/monokrome/vessel/issues

---

## Homepage

https://github.com/monokrome/vessel

---

## Privacy Policy URL

https://github.com/monokrome/vessel/blob/main/PRIVACY.md
