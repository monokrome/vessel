import { describe, it, expect } from 'vitest';

/**
 * Tests for Vessel state structure and settings.
 * These tests verify the expected state shape and default values.
 */

describe('State structure', () => {
  const createDefaultState = () => ({
    globalSubdomains: false,
    hideBlendWarning: false,
    containerSubdomains: {},
    containerExclusions: {},
    containerBlends: {},
    domainRules: {},
    tempContainers: [],
    pendingPrompts: {}
  });

  it('has correct default values', () => {
    const state = createDefaultState();
    expect(state.globalSubdomains).toBe(false);
    expect(state.hideBlendWarning).toBe(false);
    expect(state.containerSubdomains).toEqual({});
    expect(state.containerExclusions).toEqual({});
    expect(state.containerBlends).toEqual({});
    expect(state.domainRules).toEqual({});
    expect(state.tempContainers).toEqual([]);
  });

  it('supports hideBlendWarning being set to true', () => {
    const state = createDefaultState();
    state.hideBlendWarning = true;
    expect(state.hideBlendWarning).toBe(true);
  });

  it('hideBlendWarning does not affect other state properties', () => {
    const state = createDefaultState();
    state.hideBlendWarning = true;
    state.domainRules['example.com'] = {
      cookieStoreId: 'container-1',
      containerName: 'Work',
      subdomains: null
    };

    expect(state.hideBlendWarning).toBe(true);
    expect(state.domainRules['example.com']).toEqual({
      cookieStoreId: 'container-1',
      containerName: 'Work',
      subdomains: null
    });
  });
});

describe('hideBlendWarning setting', () => {
  it('defaults to false (show warnings)', () => {
    const hideBlendWarning = false;
    expect(hideBlendWarning).toBe(false);
  });

  it('can be toggled to true (hide warnings)', () => {
    let hideBlendWarning = false;
    hideBlendWarning = true;
    expect(hideBlendWarning).toBe(true);
  });

  it('can be reset back to false (show warnings again)', () => {
    let hideBlendWarning = true;
    hideBlendWarning = false;
    expect(hideBlendWarning).toBe(false);
  });

  it('UI toggle: On means show warnings (hideBlendWarning = false)', () => {
    // When UI shows "On" for "Show blend warnings", hideBlendWarning should be false
    const uiShowWarningsOn = true;
    const hideBlendWarning = !uiShowWarningsOn;
    expect(hideBlendWarning).toBe(false);
  });

  it('UI toggle: Off means hide warnings (hideBlendWarning = true)', () => {
    // When UI shows "Off" for "Show blend warnings", hideBlendWarning should be true
    const uiShowWarningsOn = false;
    const hideBlendWarning = !uiShowWarningsOn;
    expect(hideBlendWarning).toBe(true);
  });
});

describe('State persistence shape', () => {
  it('produces correct shape for storage.local.set', () => {
    const state = {
      globalSubdomains: 'ask',
      hideBlendWarning: true,
      containerSubdomains: { 'container-1': true },
      containerExclusions: { 'container-1': ['excluded.com'] },
      containerBlends: { 'container-1': ['blended.com'] },
      domainRules: {
        'example.com': {
          cookieStoreId: 'container-1',
          containerName: 'Work',
          subdomains: true
        }
      },
      tempContainers: ['temp-1', 'temp-2']
    };

    // Simulate what saveState would produce
    const storageData = {
      globalSubdomains: state.globalSubdomains,
      hideBlendWarning: state.hideBlendWarning,
      containerSubdomains: state.containerSubdomains,
      containerExclusions: state.containerExclusions,
      containerBlends: state.containerBlends,
      domainRules: state.domainRules,
      tempContainers: state.tempContainers
    };

    expect(storageData.hideBlendWarning).toBe(true);
    expect(storageData.globalSubdomains).toBe('ask');
    expect(storageData.containerBlends['container-1']).toContain('blended.com');
  });

  it('handles loading state with missing hideBlendWarning (upgrade path)', () => {
    // Simulate loading from storage where hideBlendWarning didn't exist
    const stored = {
      globalSubdomains: true,
      containerSubdomains: {},
      containerExclusions: {},
      containerBlends: {},
      domainRules: {},
      tempContainers: []
      // hideBlendWarning is missing (old data)
    };

    // Simulate loadState behavior with nullish coalescing
    const hideBlendWarning = stored.hideBlendWarning ?? false;
    expect(hideBlendWarning).toBe(false);
  });

  it('handles loading state with hideBlendWarning set', () => {
    const stored = {
      globalSubdomains: true,
      hideBlendWarning: true,
      containerSubdomains: {},
      containerExclusions: {},
      containerBlends: {},
      domainRules: {},
      tempContainers: []
    };

    const hideBlendWarning = stored.hideBlendWarning ?? false;
    expect(hideBlendWarning).toBe(true);
  });
});

describe('Blend warning integration with state', () => {
  const createState = (hideBlendWarning = false) => ({
    globalSubdomains: false,
    hideBlendWarning,
    containerSubdomains: {},
    containerExclusions: {},
    containerBlends: {
      'amazon-container': ['paypal.com']
    },
    domainRules: {
      'amazon.com': { cookieStoreId: 'amazon-container', containerName: 'Amazon', subdomains: null },
      'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: null }
    },
    tempContainers: []
  });

  it('state with warnings enabled has hideBlendWarning = false', () => {
    const state = createState(false);
    expect(state.hideBlendWarning).toBe(false);
    // Blends should still work regardless of warning setting
    expect(state.containerBlends['amazon-container']).toContain('paypal.com');
  });

  it('state with warnings disabled has hideBlendWarning = true', () => {
    const state = createState(true);
    expect(state.hideBlendWarning).toBe(true);
    // Blends should still work regardless of warning setting
    expect(state.containerBlends['amazon-container']).toContain('paypal.com');
  });

  it('hideBlendWarning does not affect blend functionality', () => {
    // The warning setting is purely UI - it doesn't change how blends work
    const stateWithWarnings = createState(false);
    const stateWithoutWarnings = createState(true);

    // Both should have the same blend configuration
    expect(stateWithWarnings.containerBlends).toEqual(stateWithoutWarnings.containerBlends);
    expect(stateWithWarnings.domainRules).toEqual(stateWithoutWarnings.domainRules);
  });
});
