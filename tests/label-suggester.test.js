'use strict';

const { suggestLabels, hasTestFiles } = require('../src/label-suggester');

describe('suggestLabels', () => {
  test('returns empty array when no criteria match', () => {
    const labels = suggestLabels({
      platformImpact: { affectsAuth: false, affectsMiddleware: false },
      fileList: ['src/utils.js'],
      prTitle: 'Minor update',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toHaveLength(0);
  });

  test('adds security label when affectsAuth is true', () => {
    const labels = suggestLabels({
      platformImpact: { affectsAuth: true },
      fileList: [],
      prTitle: 'Update auth',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('security');
  });

  test('adds security label when affectsMiddleware is true', () => {
    const labels = suggestLabels({
      platformImpact: { affectsMiddleware: true },
      fileList: [],
      prTitle: 'Update middleware',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('security');
  });

  test('adds database label when affectsSchema is true', () => {
    const labels = suggestLabels({
      platformImpact: { affectsSchema: true },
      fileList: [],
      prTitle: 'Add migration',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('database');
  });

  test('adds dependencies label when affectsDependencies is true', () => {
    const labels = suggestLabels({
      platformImpact: { affectsDependencies: true },
      fileList: ['package.json'],
      prTitle: 'Update deps',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('dependencies');
  });

  test('adds breaking-change label when breaking keyword in title', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: ['src/api.js'],
      prTitle: 'Breaking: Remove deprecated endpoint',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('breaking-change');
  });

  test('adds needs-tests label when no test files and code changes exist', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: ['src/feature.js', 'src/utils.js'],
      prTitle: 'Add feature',
      prBody: '',
      hasTestFiles: false
    });
    expect(labels).toContain('needs-tests');
  });

  test('does not add needs-tests when hasTestFiles is true', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: ['src/feature.js'],
      prTitle: 'Add feature',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).not.toContain('needs-tests');
  });

  test('adds performance label when performance keyword in title', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: [],
      prTitle: 'Optimize query performance',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('performance');
  });

  test('adds performance label when memory keyword in body', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: [],
      prTitle: 'Fix resource handling',
      prBody: 'Fix memory leak in browser instance',
      hasTestFiles: true
    });
    expect(labels).toContain('performance');
  });

  test('adds bug label when fix keyword in title', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: [],
      prTitle: 'Fix null pointer exception',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('bug');
  });

  test('adds enhancement label when add keyword in title', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: [],
      prTitle: 'Add new export feature',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('enhancement');
  });

  test('adds documentation label when only doc files changed', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: ['README.md', 'docs/guide.md'],
      prTitle: 'Update docs',
      prBody: '',
      hasTestFiles: false
    });
    expect(labels).toContain('documentation');
    expect(labels).not.toContain('needs-tests');
  });

  test('adds refactor label when refactor keyword present', () => {
    const labels = suggestLabels({
      platformImpact: {},
      fileList: [],
      prTitle: 'Refactor auth module',
      prBody: '',
      hasTestFiles: true
    });
    expect(labels).toContain('refactor');
  });

  test('deduplicates labels', () => {
    const labels = suggestLabels({
      platformImpact: { affectsAuth: true, affectsMiddleware: true },
      fileList: [],
      prTitle: 'Security update',
      prBody: '',
      hasTestFiles: true
    });
    const securityCount = labels.filter(l => l === 'security').length;
    expect(securityCount).toBe(1);
  });

  test('returns multiple relevant labels', () => {
    const labels = suggestLabels({
      platformImpact: { affectsAuth: true, affectsSchema: true },
      fileList: ['src/auth.js'],
      prTitle: 'Fix authentication bug with memory leak',
      prBody: '',
      hasTestFiles: false
    });
    expect(labels).toContain('security');
    expect(labels).toContain('database');
    expect(labels).toContain('bug');
    expect(labels).toContain('performance');
    expect(labels).toContain('needs-tests');
  });
});

describe('hasTestFiles', () => {
  test('returns false for empty array', () => {
    expect(hasTestFiles([])).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(hasTestFiles(null)).toBe(false);
    expect(hasTestFiles(undefined)).toBe(false);
  });

  test('returns true for .test.js files', () => {
    expect(hasTestFiles(['src/utils.test.js'])).toBe(true);
  });

  test('returns true for .spec.js files', () => {
    expect(hasTestFiles(['src/utils.spec.js'])).toBe(true);
  });

  test('returns true for files in tests/ directory', () => {
    expect(hasTestFiles(['tests/utils.js'])).toBe(true);
  });

  test('returns true for files in __tests__/ directory', () => {
    expect(hasTestFiles(['src/__tests__/utils.js'])).toBe(true);
  });

  test('returns false for regular source files', () => {
    expect(hasTestFiles(['src/utils.js', 'src/api.js'])).toBe(false);
  });

  test('returns true if any file is a test file', () => {
    expect(hasTestFiles(['src/utils.js', 'src/utils.test.js'])).toBe(true);
  });
});
