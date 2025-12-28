import { describe, it, expect, vi } from 'vitest';
import { fuzzyMatch, matchesContainer, debounce } from '../../src/lib/fuzzy.js';

describe('fuzzyMatch', () => {
  describe('exact substring matching', () => {
    it('matches exact string', () => {
      expect(fuzzyMatch('work', 'work')).toBe(2);
    });

    it('matches substring at start', () => {
      expect(fuzzyMatch('work', 'workspace')).toBe(2);
    });

    it('matches substring in middle', () => {
      expect(fuzzyMatch('work', 'My Work')).toBe(2);
    });

    it('matches substring at end', () => {
      expect(fuzzyMatch('work', 'homework')).toBe(2);
    });
  });

  describe('fuzzy character matching', () => {
    it('matches characters in order', () => {
      expect(fuzzyMatch('wk', 'work')).toBe(1);
    });

    it('matches characters spread across text', () => {
      expect(fuzzyMatch('mwk', 'my work')).toBe(1);
    });

    it('returns 0 when characters not in order', () => {
      expect(fuzzyMatch('kw', 'work')).toBe(0);
    });

    it('returns 0 when characters missing', () => {
      expect(fuzzyMatch('xyz', 'work')).toBe(0);
    });
  });

  describe('case insensitivity', () => {
    it('matches uppercase query to lowercase text', () => {
      expect(fuzzyMatch('WORK', 'my work')).toBe(2);
    });

    it('matches lowercase query to uppercase text', () => {
      expect(fuzzyMatch('work', 'MY WORK')).toBe(2);
    });

    it('matches mixed case', () => {
      expect(fuzzyMatch('WoRk', 'wOrK')).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('returns 2 for empty query', () => {
      expect(fuzzyMatch('', 'anything')).toBe(2);
    });

    it('returns 0 for empty text', () => {
      expect(fuzzyMatch('query', '')).toBe(0);
    });

    it('returns 0 for null text', () => {
      expect(fuzzyMatch('query', null)).toBe(0);
    });

    it('matches single character', () => {
      expect(fuzzyMatch('w', 'work')).toBe(2);
    });
  });
});

describe('matchesContainer', () => {
  const container = { name: 'Personal', cookieStoreId: 'test-123' };
  const domains = [
    { domain: 'example.com' },
    { domain: 'mysite.org' },
    { domain: 'blog.personal.dev' }
  ];
  const exclusions = ['ads.example.com', 'tracker.net'];

  describe('container name matching', () => {
    it('matches full container name', () => {
      expect(matchesContainer('Personal', container, domains, exclusions)).toBe(true);
    });

    it('matches partial container name', () => {
      expect(matchesContainer('pers', container, domains, exclusions)).toBe(true);
    });

    it('matches fuzzy container name', () => {
      expect(matchesContainer('psnl', container, domains, exclusions)).toBe(true);
    });
  });

  describe('domain matching', () => {
    it('matches full domain', () => {
      expect(matchesContainer('example.com', container, domains, exclusions)).toBe(true);
    });

    it('matches partial domain', () => {
      expect(matchesContainer('example', container, domains, exclusions)).toBe(true);
    });

    it('matches any domain in list', () => {
      expect(matchesContainer('mysite', container, domains, exclusions)).toBe(true);
      expect(matchesContainer('blog', container, domains, exclusions)).toBe(true);
    });

    it('matches subdomain', () => {
      expect(matchesContainer('personal.dev', container, domains, exclusions)).toBe(true);
    });
  });

  describe('exclusion (blocked domain) matching', () => {
    it('matches blocked domain', () => {
      expect(matchesContainer('ads', container, domains, exclusions)).toBe(true);
    });

    it('matches full blocked domain', () => {
      expect(matchesContainer('tracker.net', container, domains, exclusions)).toBe(true);
    });
  });

  describe('no match', () => {
    it('returns false when nothing matches', () => {
      expect(matchesContainer('shopping', container, domains, exclusions)).toBe(false);
    });

    it('returns false for completely unrelated query', () => {
      expect(matchesContainer('xyz123', container, domains, exclusions)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns true for empty query', () => {
      expect(matchesContainer('', container, domains, exclusions)).toBe(true);
    });

    it('handles empty domains array', () => {
      expect(matchesContainer('Personal', container, [], exclusions)).toBe(true);
    });

    it('handles empty exclusions array', () => {
      expect(matchesContainer('Personal', container, domains, [])).toBe(true);
    });

    it('handles string domains (not objects)', () => {
      const stringDomains = ['example.com', 'test.org'];
      expect(matchesContainer('example', container, stringDomains, [])).toBe(true);
    });
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays function execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('only executes once for rapid calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to debounced function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('arg1', 'arg2');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('uses latest arguments when called multiple times', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    debounced('second');
    debounced('third');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('executes again after delay has passed', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
