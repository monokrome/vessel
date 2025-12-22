/**
 * Tests for HTML file structure.
 * These tests catch issues like missing type="module" on script tags,
 * which can cause silent failures when using ES module imports.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

function readFile(relativePath) {
  return fs.readFileSync(path.join(srcDir, relativePath), 'utf-8');
}

function extractScriptSrcs(html) {
  const scriptRegex = /<script([^>]*)>/g;
  const scripts = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attrs = match[1];
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/);
    if (srcMatch) {
      scripts.push({ attrs, src: srcMatch[1] });
    }
  }
  return scripts;
}

function usesEsModuleImports(jsContent) {
  // Check for import statements (ES module imports)
  return /^\s*import\s+/m.test(jsContent);
}

describe('HTML Structure', () => {
  const htmlFiles = [
    'popup/popup.html',
    'sidebar/sidebar.html',
    'pageaction/pageaction.html',
    'ask/ask.html',
  ];

  describe('Script tags with ES modules have type="module"', () => {
    for (const htmlFile of htmlFiles) {
      it(`${htmlFile} ES module scripts have type="module"`, () => {
        const html = readFile(htmlFile);
        const scripts = extractScriptSrcs(html);

        if (scripts.length === 0) return;

        for (const { attrs, src } of scripts) {
          // Get the corresponding JS file
          const jsPath = path.dirname(htmlFile) + '/' + src;
          const jsContent = readFile(jsPath);

          // If the JS file uses ES module imports, it needs type="module"
          if (usesEsModuleImports(jsContent)) {
            expect(
              attrs,
              `${htmlFile} includes ${src} which uses ES imports but script tag lacks type="module"`,
            ).toMatch(/type\s*=\s*["']module["']/);
          }
        }
      });
    }
  });

  describe('Required HTML elements exist', () => {
    it('popup.html has essential elements', () => {
      const html = readFile('popup/popup.html');
      expect(html).toContain('id="containerList"');
    });

    it('sidebar.html has essential elements', () => {
      const html = readFile('sidebar/sidebar.html');
      expect(html).toContain('id="containerList"');
      expect(html).toContain('id="pendingList"');
      expect(html).toContain('id="tabContainers"');
      expect(html).toContain('id="tabPending"');
    });

    it('pageaction.html has essential elements', () => {
      const html = readFile('pageaction/pageaction.html');
      expect(html).toContain('id="domain"');
      expect(html).toContain('id="containerList"');
    });
  });
});
