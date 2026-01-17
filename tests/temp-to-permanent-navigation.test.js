/**
 * Tests for navigation from temporary containers to permanent containers
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getContainerForUrl } from '../src/background/navigation.js';
import { state } from '../src/background/state.js';
import { FIREFOX_DEFAULT_CONTAINER } from '../src/lib/constants.js';

describe('Navigation from temp to permanent containers', () => {
  beforeEach(() => {
    // Reset state
    state.domainRules = {};
    state.tempContainers = [];
    state.containerBlends = {};
    state.containerSubdomains = {};
    state.containerExclusions = {};
    state.globalSubdomains = false;
    state.stripWww = false;
  });

  it('should switch from temp container to permanent container when clicking link', () => {
    // Setup: temp container and permanent rule
    const tempContainerId = 'firefox-container-temp123';
    const permanentContainerId = 'firefox-container-shopping';

    state.tempContainers = [tempContainerId];
    state.domainRules = {
      'example.com': {
        containerName: 'Shopping',
        cookieStoreId: permanentContainerId
      }
    };

    // User in temp container clicks link to example.com
    const result = getContainerForUrl('https://example.com', tempContainerId);

    // Should switch to permanent container
    expect(result).toEqual({
      targetCookieStoreId: permanentContainerId
    });
  });

  it('should switch from temp container to different permanent container', () => {
    const tempContainerId = 'firefox-container-temp456';
    const workContainerId = 'firefox-container-work';
    const shoppingContainerId = 'firefox-container-shopping';

    state.tempContainers = [tempContainerId];
    state.domainRules = {
      'work.example.com': {
        containerName: 'Work',
        cookieStoreId: workContainerId
      },
      'shop.example.com': {
        containerName: 'Shopping',
        cookieStoreId: shoppingContainerId
      }
    };

    // User in temp container clicks link to shop.example.com
    const result = getContainerForUrl('https://shop.example.com', tempContainerId);

    // Should switch to shopping container, not work container
    expect(result).toEqual({
      targetCookieStoreId: shoppingContainerId
    });
  });

  it('should create temp container when no rule exists', () => {
    const tempContainerId = 'firefox-container-temp789';

    state.tempContainers = [tempContainerId];
    state.domainRules = {};

    // User in temp container clicks link to unknown domain
    const result = getContainerForUrl('https://unknown.com', tempContainerId);

    // Should stay in temp container (no switch)
    expect(result).toBeNull();
  });

  it('should not switch if already in correct container', () => {
    const shoppingContainerId = 'firefox-container-shopping';

    state.domainRules = {
      'shop.example.com': {
        containerName: 'Shopping',
        cookieStoreId: shoppingContainerId
      }
    };

    // User already in shopping container clicks link to shop.example.com
    const result = getContainerForUrl('https://shop.example.com', shoppingContainerId);

    // Should not switch
    expect(result).toBeNull();
  });
});
