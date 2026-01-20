/**
 * UI strings for Vessel extension
 * Centralized for future i18n/l10n support
 */

export const STRINGS = {
  // App
  appName: 'Vessel',

  // Empty states
  emptyContainers: 'No containers',
  emptyDomains: 'No domains',
  emptyExclusions: 'No exclusions',
  emptyBlends: 'No blended domains',
  emptyPending: 'No pending requests for this tab',

  // Section headers
  headerExclusions: 'Excluded Subdomains',
  headerBlends: 'Blended Domains',
  headerPending: 'Pending Requests',

  // Labels
  labelSubdomainsGlobal: 'Include subdomains (global)',
  labelStripWww: 'Treat www as parent domain',
  labelSubdomainsContainer: 'Subdomains default',
  labelShowBlendWarnings: 'Show blend warnings',

  // Placeholders
  placeholderNewContainer: 'New container name',
  placeholderAddDomain: 'Add domain (e.g. example.com)',
  placeholderAddExclusion: 'Add exclusion (e.g. sub.example.com)',
  placeholderAddBlend: 'Allow domain from another container',

  // Buttons
  btnContainers: 'Containers',
  btnPending: 'Pending',
  btnDeleteContainer: 'Delete Container',
  btnCancel: 'Cancel',
  btnAddBlend: 'Add Blend',
  btnAllow: 'Allow',
  btnBlock: 'Block',

  // Toggle options
  toggleOn: 'On',
  toggleOff: 'Off',
  toggleAsk: 'Ask',
  toggleInherit: 'Inherit',

  // Blend warning dialog
  blendWarningTitle: 'What is blending?',
  blendWarningP1: 'Blending allows a domain that belongs to another container to also work in this container.',
  blendWarningP2: 'This is useful when a site loads resources from a domain you\'ve assigned elsewhere (e.g., a CDN or login provider).',
  blendWarningNote: 'Use sparingly - blending reduces container isolation.',
  blendWarningDontShow: 'Don\'t show this again',

  // Blend info
  blendFromContainer: 'from {container}',

  // Pending requests
  pendingCount: '{count} req',
  pendingCountPlural: '{count} reqs',

  // Errors
  errorInvalidUrl: 'Invalid URL',
  errorNoDomain: 'No domain',
};
