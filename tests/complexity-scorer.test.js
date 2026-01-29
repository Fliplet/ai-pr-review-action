'use strict';

const { scorePRComplexity, recommendModel } = require('../src/complexity-scorer');
const { MODELS } = require('../src/constants');

function makeFile(path, additions, deletions, hunkCount) {
  return {
    path,
    additions,
    deletions,
    hunks: Array.from({ length: hunkCount || 1 }, () => ({
      header: '@@ -1,1 +1,1 @@',
      changes: []
    }))
  };
}

describe('scorePRComplexity', () => {
  test('returns 0 for a trivial PR', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({ files, prTitle: 'Fix typo', prBody: '' });
    expect(score).toBe(0);
  });

  test('adds 20 for >200 total changes', () => {
    const files = [makeFile('src/big.js', 150, 60)];
    const score = scorePRComplexity({ files, prTitle: '', prBody: '' });
    // 200+ changes: +20, large file (>100): +15
    expect(score).toBeGreaterThanOrEqual(20);
  });

  test('adds 15 for >10 files', () => {
    const files = Array.from({ length: 12 }, (_, i) => makeFile(`file${i}.js`, 1, 0));
    const score = scorePRComplexity({ files, prTitle: '', prBody: '' });
    expect(score).toBeGreaterThanOrEqual(15);
  });

  test('adds 25 for security-sensitive files', () => {
    const files = [makeFile('src/auth.js', 5, 2)];
    const score = scorePRComplexity({ files, prTitle: '', prBody: '' });
    expect(score).toBe(25);
  });

  test('adds 15 for complexity keywords in title', () => {
    const files = [makeFile('src/utils.js', 5, 2)];
    const score = scorePRComplexity({ files, prTitle: 'Refactor authentication', prBody: '' });
    // refactor keyword: +15, auth file: no (it's in title not path)
    expect(score).toBeGreaterThanOrEqual(15);
  });

  test('adds 15 for complexity keywords in body', () => {
    const files = [makeFile('src/utils.js', 5, 2)];
    const score = scorePRComplexity({ files, prTitle: '', prBody: 'This is a breaking change to the migration system' });
    // breaking + migration = +15 (only once)
    expect(score).toBeGreaterThanOrEqual(15);
  });

  test('adds 10 for >20 total hunks', () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`file${i}.js`, 3, 1, 5));
    const score = scorePRComplexity({ files, prTitle: '', prBody: '' });
    // 25 hunks > 20: +10
    expect(score).toBeGreaterThanOrEqual(10);
  });

  test('adds 15 for a large single file', () => {
    const files = [makeFile('src/big.js', 80, 30)];
    const score = scorePRComplexity({ files, prTitle: '', prBody: '' });
    // 110 changes in one file > 100: +15
    expect(score).toBeGreaterThanOrEqual(15);
  });

  test('caps at 100', () => {
    // Create a PR that triggers all criteria
    const files = [
      ...Array.from({ length: 12 }, (_, i) => makeFile(`src/auth/route${i}.js`, 20, 10, 3)),
    ];
    const score = scorePRComplexity({
      files,
      prTitle: 'Refactor security architecture rewrite',
      prBody: 'Breaking migration changes'
    });
    expect(score).toBeLessThanOrEqual(100);
  });

  test('handles missing prTitle and prBody', () => {
    const files = [makeFile('src/utils.js', 5, 2)];
    const score = scorePRComplexity({ files, prTitle: undefined, prBody: undefined });
    expect(score).toBe(0);
  });

  test('complex PR with security files and many changes scores high', () => {
    const files = [
      makeFile('src/middleware/auth.js', 80, 30, 4),
      makeFile('src/routes/api.js', 60, 20, 3),
      makeFile('src/session.js', 40, 10, 2),
      makeFile('src/utils.js', 30, 10, 2),
      makeFile('src/helpers.js', 20, 5, 1)
    ];
    const score = scorePRComplexity({
      files,
      prTitle: 'Security refactor of auth system',
      prBody: ''
    });
    // Should score >= 40 to trigger Opus
    expect(score).toBeGreaterThanOrEqual(40);
  });
});

describe('scorePRComplexity with platformImpact', () => {
  test('adds 30 for critical platform impact', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({
      files,
      prTitle: '',
      prBody: '',
      platformImpact: { level: 'critical', affectsSchema: false }
    });
    expect(score).toBe(30);
  });

  test('adds 20 for high platform impact', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({
      files,
      prTitle: '',
      prBody: '',
      platformImpact: { level: 'high', affectsSchema: false }
    });
    expect(score).toBe(20);
  });

  test('adds 10 for medium platform impact', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({
      files,
      prTitle: '',
      prBody: '',
      platformImpact: { level: 'medium', affectsSchema: false }
    });
    expect(score).toBe(10);
  });

  test('adds 0 for low platform impact', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({
      files,
      prTitle: '',
      prBody: '',
      platformImpact: { level: 'low', affectsSchema: false }
    });
    expect(score).toBe(0);
  });

  test('adds additional 15 for affectsSchema', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({
      files,
      prTitle: '',
      prBody: '',
      platformImpact: { level: 'critical', affectsSchema: true }
    });
    expect(score).toBe(45); // 30 (critical) + 15 (schema)
  });

  test('backwards-compatible: no platformImpact means no boost', () => {
    const files = [makeFile('src/utils.js', 2, 1)];
    const score = scorePRComplexity({ files, prTitle: '', prBody: '' });
    expect(score).toBe(0);
  });

  test('platform impact + other criteria still caps at 100', () => {
    const files = [
      ...Array.from({ length: 12 }, (_, i) => makeFile(`src/auth/route${i}.js`, 20, 10, 3)),
    ];
    const score = scorePRComplexity({
      files,
      prTitle: 'Refactor security architecture rewrite',
      prBody: 'Breaking migration changes',
      platformImpact: { level: 'critical', affectsSchema: true }
    });
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('recommendModel', () => {
  test('returns Opus for score >= 40', () => {
    expect(recommendModel(40)).toBe(MODELS.OPUS);
    expect(recommendModel(60)).toBe(MODELS.OPUS);
    expect(recommendModel(100)).toBe(MODELS.OPUS);
  });

  test('returns Sonnet for score < 40', () => {
    expect(recommendModel(0)).toBe(MODELS.SONNET);
    expect(recommendModel(20)).toBe(MODELS.SONNET);
    expect(recommendModel(39)).toBe(MODELS.SONNET);
  });
});
