/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  escapeHtml,
  escapeAttr,
  parseValue,
  updateToggle,
  getContainerColor,
  getDomainsForContainer,
  getExclusionsForContainer,
  getBlendsForContainer,
  findDomainOwner,
  renderContainerList,
  renderDomainList,
  renderExclusionList,
  renderBlendList,
  createRenameInput
} from '../../src/lib/ui-shared.js';
import { CONTAINER_COLORS } from '../../src/lib/constants.js';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('does not escape quotes (use escapeAttr for attributes)', () => {
    expect(escapeHtml('"quoted"')).toBe('"quoted"');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles plain text without modification', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('escapeAttr', () => {
  it('escapes double quotes', () => {
    expect(escapeAttr('test"value')).toBe('test&quot;value');
  });

  it('escapes single quotes', () => {
    expect(escapeAttr("test'value")).toBe('test&#39;value');
  });

  it('escapes angle brackets', () => {
    expect(escapeAttr('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeAttr('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes all dangerous characters together', () => {
    expect(escapeAttr('"><script>alert(1)</script>')).toBe(
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('handles plain text without modification', () => {
    expect(escapeAttr('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(escapeAttr('')).toBe('');
  });
});

describe('parseValue', () => {
  it('parses "true" to boolean true', () => {
    expect(parseValue('true')).toBe(true);
  });

  it('parses "false" to boolean false', () => {
    expect(parseValue('false')).toBe(false);
  });

  it('parses "ask" to string "ask"', () => {
    expect(parseValue('ask')).toBe('ask');
  });

  it('returns null for "null"', () => {
    expect(parseValue('null')).toBe(null);
  });

  it('returns null for unknown values', () => {
    expect(parseValue('unknown')).toBe(null);
    expect(parseValue('')).toBe(null);
  });
});

describe('updateToggle', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = `
      <button data-value="true">On</button>
      <button data-value="false">Off</button>
      <button data-value="null">Inherit</button>
    `;
  });

  it('activates button matching true value', () => {
    updateToggle(container, true);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].classList.contains('active')).toBe(true);
    expect(buttons[1].classList.contains('active')).toBe(false);
    expect(buttons[2].classList.contains('active')).toBe(false);
  });

  it('activates button matching false value', () => {
    updateToggle(container, false);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].classList.contains('active')).toBe(false);
    expect(buttons[1].classList.contains('active')).toBe(true);
    expect(buttons[2].classList.contains('active')).toBe(false);
  });

  it('activates button matching null value', () => {
    updateToggle(container, null);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].classList.contains('active')).toBe(false);
    expect(buttons[1].classList.contains('active')).toBe(false);
    expect(buttons[2].classList.contains('active')).toBe(true);
  });

  it('deactivates all buttons when no match', () => {
    updateToggle(container, 'nomatch');

    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
      expect(btn.classList.contains('active')).toBe(false);
    });
  });
});

describe('getContainerColor', () => {
  it('returns correct color for known colors', () => {
    expect(getContainerColor('blue')).toBe(CONTAINER_COLORS.blue);
    expect(getContainerColor('red')).toBe(CONTAINER_COLORS.red);
    expect(getContainerColor('green')).toBe(CONTAINER_COLORS.green);
  });

  it('returns toolbar color for unknown colors', () => {
    expect(getContainerColor('unknown')).toBe(CONTAINER_COLORS.toolbar);
    expect(getContainerColor('')).toBe(CONTAINER_COLORS.toolbar);
  });
});

describe('getDomainsForContainer', () => {
  it('returns domains matching container', () => {
    const state = {
      domainRules: {
        'example.com': { cookieStoreId: 'container-1', subdomains: true },
        'other.com': { cookieStoreId: 'container-2', subdomains: false },
        'another.com': { cookieStoreId: 'container-1', subdomains: null },
      }
    };

    const domains = getDomainsForContainer(state, 'container-1');

    expect(domains).toHaveLength(2);
    expect(domains).toContainEqual({ domain: 'example.com', subdomains: true });
    expect(domains).toContainEqual({ domain: 'another.com', subdomains: null });
  });

  it('returns empty array when no domains match', () => {
    const state = {
      domainRules: {
        'example.com': { cookieStoreId: 'container-1' },
      }
    };

    expect(getDomainsForContainer(state, 'container-999')).toEqual([]);
  });

  it('returns empty array when no domain rules exist', () => {
    const state = { domainRules: {} };
    expect(getDomainsForContainer(state, 'container-1')).toEqual([]);
  });
});

describe('getExclusionsForContainer', () => {
  it('returns exclusions for container', () => {
    const state = {
      containerExclusions: {
        'container-1': ['blocked.com', 'spam.com'],
        'container-2': ['other.com'],
      }
    };

    expect(getExclusionsForContainer(state, 'container-1')).toEqual(['blocked.com', 'spam.com']);
  });

  it('returns empty array when no exclusions exist', () => {
    const state = { containerExclusions: {} };
    expect(getExclusionsForContainer(state, 'container-1')).toEqual([]);
  });
});

describe('getBlendsForContainer', () => {
  it('returns blends for container', () => {
    const state = {
      containerBlends: {
        'container-1': ['cdn.example.com', 'auth.example.com'],
        'container-2': ['other.com'],
      }
    };

    expect(getBlendsForContainer(state, 'container-1')).toEqual(['cdn.example.com', 'auth.example.com']);
  });

  it('returns empty array when no blends exist', () => {
    const state = { containerBlends: {} };
    expect(getBlendsForContainer(state, 'container-1')).toEqual([]);
  });

  it('handles missing containerBlends key', () => {
    const state = {};
    expect(getBlendsForContainer(state, 'container-1')).toEqual([]);
  });
});

describe('findDomainOwner', () => {
  const containers = [
    { cookieStoreId: 'container-1', name: 'Work' },
    { cookieStoreId: 'container-2', name: 'Personal' },
  ];

  it('returns container name for owned domain', () => {
    const state = {
      domainRules: {
        'example.com': { cookieStoreId: 'container-1' },
      }
    };

    expect(findDomainOwner('example.com', state, containers)).toBe('Work');
  });

  it('returns null for unknown domain', () => {
    const state = { domainRules: {} };
    expect(findDomainOwner('unknown.com', state, containers)).toBe(null);
  });

  it('returns null when container not found', () => {
    const state = {
      domainRules: {
        'example.com': { cookieStoreId: 'deleted-container' },
      }
    };

    expect(findDomainOwner('example.com', state, containers)).toBe(null);
  });
});

describe('renderBlendList', () => {
  let listElement;
  const containers = [
    { cookieStoreId: 'container-1', name: 'Work' },
    { cookieStoreId: 'container-2', name: 'Personal' },
  ];

  beforeEach(() => {
    listElement = document.createElement('div');
  });

  it('renders blends with source container', () => {
    const state = {
      containerBlends: {
        'container-1': ['cdn.example.com'],
      },
      domainRules: {
        'cdn.example.com': { cookieStoreId: 'container-2' },
      }
    };

    renderBlendList(state, 'container-1', listElement, containers);

    expect(listElement.innerHTML).toContain('cdn.example.com');
    expect(listElement.innerHTML).toContain('from Personal');
    expect(listElement.querySelectorAll('.blend-item')).toHaveLength(1);
  });

  it('shows empty state when no blends', () => {
    const state = { containerBlends: {} };
    renderBlendList(state, 'container-1', listElement, containers);
    expect(listElement.innerHTML).toContain('No blended domains');
  });

  it('handles blend without known owner', () => {
    const state = {
      containerBlends: {
        'container-1': ['unknown-origin.com'],
      },
      domainRules: {}
    };

    renderBlendList(state, 'container-1', listElement, containers);

    expect(listElement.innerHTML).toContain('unknown-origin.com');
    expect(listElement.innerHTML).not.toContain('from');
  });
});

describe('renderContainerList', () => {
  let listElement;
  const state = {
    domainRules: {
      'example.com': { cookieStoreId: 'container-1' },
      'other.com': { cookieStoreId: 'container-1' },
    }
  };

  beforeEach(() => {
    listElement = document.createElement('div');
  });

  it('renders containers with domain counts', () => {
    const containers = [
      { cookieStoreId: 'container-1', name: 'Work', color: 'blue' },
      { cookieStoreId: 'container-2', name: 'Personal', color: 'green' },
    ];

    renderContainerList(containers, state, listElement);

    expect(listElement.innerHTML).toContain('Work');
    expect(listElement.innerHTML).toContain('Personal');
    expect(listElement.innerHTML).toContain('2'); // Work has 2 domains
    expect(listElement.innerHTML).toContain('0'); // Personal has 0 domains
  });

  it('shows empty state when no containers', () => {
    renderContainerList([], state, listElement);
    expect(listElement.innerHTML).toContain('No containers');
  });

  it('escapes container names', () => {
    const containers = [
      { cookieStoreId: 'container-1', name: '<script>xss</script>', color: 'blue' },
    ];

    renderContainerList(containers, state, listElement);
    expect(listElement.innerHTML).not.toContain('<script>');
    expect(listElement.innerHTML).toContain('&lt;script&gt;');
  });
});

describe('renderDomainList', () => {
  let listElement;

  beforeEach(() => {
    listElement = document.createElement('div');
  });

  it('renders domains with subdomain toggles', () => {
    const state = {
      domainRules: {
        'example.com': { cookieStoreId: 'container-1', subdomains: true },
        'other.com': { cookieStoreId: 'container-1', subdomains: false },
      }
    };

    renderDomainList(state, 'container-1', listElement);

    expect(listElement.innerHTML).toContain('example.com');
    expect(listElement.innerHTML).toContain('other.com');
    expect(listElement.querySelectorAll('.domain-item')).toHaveLength(2);
  });

  it('shows empty state when no domains', () => {
    const state = { domainRules: {} };
    renderDomainList(state, 'container-1', listElement);
    expect(listElement.innerHTML).toContain('No domains');
  });

  it('escapes domain names in text and attributes', () => {
    const state = {
      domainRules: {
        '"><script>xss</script>': { cookieStoreId: 'container-1', subdomains: null },
      }
    };

    renderDomainList(state, 'container-1', listElement);

    // Text content should be escaped
    expect(listElement.querySelector('.domain-name').textContent).toBe('"><script>xss</script>');

    // Attribute should be escaped (check via getAttribute which decodes entities)
    const toggle = listElement.querySelector('.domain-subdomains-toggle');
    expect(toggle.getAttribute('data-domain')).toBe('"><script>xss</script>');

    // Raw HTML should not contain unescaped script tags that could execute
    expect(listElement.innerHTML).toContain('&lt;script&gt;');
    expect(listElement.innerHTML).toContain('&quot;');
  });
});

describe('renderExclusionList', () => {
  let listElement;

  beforeEach(() => {
    listElement = document.createElement('div');
  });

  it('renders exclusions with remove buttons', () => {
    const state = {
      containerExclusions: {
        'container-1': ['blocked.com', 'spam.com'],
      }
    };

    renderExclusionList(state, 'container-1', listElement);

    expect(listElement.innerHTML).toContain('blocked.com');
    expect(listElement.innerHTML).toContain('spam.com');
    expect(listElement.querySelectorAll('.exclusion-item')).toHaveLength(2);
    expect(listElement.querySelectorAll('.remove-exclusion-btn')).toHaveLength(2);
  });

  it('shows empty state when no exclusions', () => {
    const state = { containerExclusions: {} };
    renderExclusionList(state, 'container-1', listElement);
    expect(listElement.innerHTML).toContain('No exclusions');
  });
});

describe('createRenameInput', () => {
  let titleElement;
  let header;

  beforeEach(() => {
    header = document.createElement('div');
    header.className = 'header';
    titleElement = document.createElement('h2');
    titleElement.textContent = 'Original Name';
    header.appendChild(titleElement);
    document.body.appendChild(header);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates input field with current name', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, onCancel);

    const input = document.querySelector('.title-input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('Original Name');
  });

  it('hides title element when input is created', () => {
    createRenameInput(titleElement, 'Original Name', vi.fn(), vi.fn());
    expect(titleElement.style.display).toBe('none');
  });

  it('focuses and selects input', () => {
    createRenameInput(titleElement, 'Original Name', vi.fn(), vi.fn());

    const input = document.querySelector('.title-input');
    expect(document.activeElement).toBe(input);
  });

  it('calls onSave with new name on Enter', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, onCancel);

    const input = document.querySelector('.title-input');
    input.value = 'New Name';

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(enterEvent);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onSave).toHaveBeenCalledWith('New Name');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, onCancel);

    const input = document.querySelector('.title-input');
    input.value = 'Changed';

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input.dispatchEvent(escEvent);

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave on blur with changed name', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, onCancel);

    const input = document.querySelector('.title-input');
    input.value = 'Blurred Name';
    input.blur();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onSave).toHaveBeenCalledWith('Blurred Name');
  });

  it('calls onCancel when name unchanged', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, onCancel);

    const input = document.querySelector('.title-input');
    // Keep same value
    input.blur();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onCancel when name is empty', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, onCancel);

    const input = document.querySelector('.title-input');
    input.value = '';

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(enterEvent);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes input after save', async () => {
    createRenameInput(titleElement, 'Original Name', vi.fn(), vi.fn());

    const input = document.querySelector('.title-input');
    input.value = 'New Name';

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(enterEvent);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(document.querySelector('.title-input')).toBeNull();
    expect(titleElement.style.display).toBe('');
  });

  it('prevents double-save on rapid events', async () => {
    const onSave = vi.fn();

    createRenameInput(titleElement, 'Original Name', onSave, vi.fn());

    const input = document.querySelector('.title-input');
    input.value = 'New Name';

    // Trigger both Enter and blur rapidly
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    input.dispatchEvent(enterEvent);
    input.blur();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
