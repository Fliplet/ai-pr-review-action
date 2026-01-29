'use strict';

const { generateTestSuggestions } = require('../src/test-suggestions');

function makeFile(filePath, additions, deletions, hunks) {
  return {
    path: filePath,
    additions: additions || 10,
    deletions: deletions || 5,
    hunks: hunks || [{
      header: '@@ -1,1 +1,1 @@',
      changes: [
        { type: 'addition', content: 'const x = 1;', line: 1 }
      ]
    }]
  };
}

function makeLowImpact() {
  return {
    level: 'low',
    affectsAuth: false,
    affectsData: false,
    affectsMiddleware: false,
    affectsSchema: false,
    affectsRoutes: false,
    affectsDependencies: false
  };
}

function makeHighImpact(overrides) {
  return {
    level: 'high',
    affectsAuth: false,
    affectsData: false,
    affectsMiddleware: false,
    affectsSchema: false,
    affectsRoutes: false,
    affectsDependencies: false,
    ...overrides
  };
}

describe('generateTestSuggestions', () => {
  test('trivial PR (< 30 lines, low impact) returns no suggestions', () => {
    const files = [makeFile('src/utils.js', 5, 3)];
    const impact = makeLowImpact();
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result).toHaveLength(0);
  });

  test('route change without test files returns 1 suggestion', () => {
    const files = [makeFile('routes/v1/apps.js', 20, 10)];
    const impact = makeHighImpact({ affectsRoutes: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(s => s.severity === 'suggestion')).toBe(true);
  });

  test('auth change without test files returns 1 warning', () => {
    const files = [makeFile('libs/authenticate.js', 20, 10)];
    const impact = makeHighImpact({ affectsAuth: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result.some(s => s.severity === 'warning')).toBe(true);
  });

  test('new endpoint without tests returns suggestion', () => {
    const files = [{
      path: 'routes/v1/apps.js',
      additions: 20,
      deletions: 0,
      hunks: [{
        header: '@@ -1,1 +1,5 @@',
        changes: [
          { type: 'addition', content: "router.post('/apps', async function(req, res) {", line: 10 },
          { type: 'addition', content: '  res.json({ ok: true });', line: 11 },
          { type: 'addition', content: '});', line: 12 }
        ]
      }]
    }];
    const impact = makeHighImpact({ affectsRoutes: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('PR with test files returns no suggestions', () => {
    const files = [
      makeFile('libs/authenticate.js', 20, 10),
      makeFile('tests/auth.test.js', 30, 5)
    ];
    const impact = makeHighImpact({ affectsAuth: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result).toHaveLength(0);
  });

  test('caps at 2 suggestions', () => {
    const files = [
      makeFile('libs/authenticate.js', 20, 10),
      makeFile('routes/v1/auth.js', 20, 10),
      {
        path: 'routes/v1/session.js',
        additions: 20,
        deletions: 0,
        hunks: [{
          header: '@@ -1,1 +1,5 @@',
          changes: [
            { type: 'addition', content: "router.get('/session', async function(req, res) {", line: 5 }
          ]
        }]
      }
    ];
    const impact = makeHighImpact({ affectsAuth: true, affectsRoutes: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('deduplicates when Claude already mentioned tests', () => {
    const files = [makeFile('libs/authenticate.js', 20, 10)];
    const impact = makeHighImpact({ affectsAuth: true });
    const existingComments = [{ body: 'Consider adding unit tests for this authentication change.' }];
    const result = generateTestSuggestions(files, impact, 'fliplet-api', existingComments);
    expect(result).toHaveLength(0);
  });

  test('non-trivial low-impact PR (>= 30 lines) still checks for gaps', () => {
    // Over 30 lines but low impact — should still check
    const files = [makeFile('routes/v1/utils.js', 25, 10)];
    const impact = { ...makeLowImpact() };
    // Even though impact is low, lines >= 30 so it won't skip
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    // routes/ file detected — should get suggestion
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('handles empty existing comments array', () => {
    const files = [makeFile('routes/v1/apps.js', 20, 10)];
    const impact = makeHighImpact({ affectsRoutes: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', []);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('handles null existing comments', () => {
    const files = [makeFile('routes/v1/apps.js', 20, 10)];
    const impact = makeHighImpact({ affectsRoutes: true });
    const result = generateTestSuggestions(files, impact, 'fliplet-api', null);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
