'use strict';

const { assessPlatformImpact } = require('../src/platform-impact');

function makeFile(filePath) {
  return {
    path: filePath,
    additions: 10,
    deletions: 5,
    hunks: [{ header: '@@ -1,1 +1,1 @@', changes: [] }]
  };
}

describe('assessPlatformImpact', () => {
  test('trivial PR returns level: low', () => {
    const files = [makeFile('src/utils.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.level).toBe('low');
    expect(result.impacts).toHaveLength(0);
    expect(result.summary).toBe('');
  });

  test('PR touching auth route sets affectsAuth and level high+', () => {
    const files = [makeFile('routes/v1/auth.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsAuth).toBe(true);
    expect(['critical', 'high']).toContain(result.level);
  });

  test('PR touching libs/authenticate.js sets affectsAuth', () => {
    const files = [makeFile('libs/authenticate.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsAuth).toBe(true);
    expect(result.level).toBe('critical'); // architecture JSON marks auth as critical
  });

  test('PR with migration file sets affectsSchema and level critical', () => {
    const files = [makeFile('models/migrations/20240101-add-column.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsSchema).toBe(true);
    expect(result.level).toBe('critical');
  });

  test('PR touching libs/middlewares/app.js sets affectsMiddleware and level critical', () => {
    const files = [makeFile('libs/middlewares/app.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsMiddleware).toBe(true);
    expect(result.level).toBe('critical');
  });

  test('PR with package.json sets affectsDependencies', () => {
    const files = [makeFile('package.json')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsDependencies).toBe(true);
  });

  test('PR touching libs/datasources.js sets affectsData', () => {
    const files = [makeFile('libs/datasources.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsData).toBe(true);
    expect(['critical', 'high']).toContain(result.level);
  });

  test('PR touching routes/ sets affectsRoutes', () => {
    const files = [makeFile('routes/v1/apps.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.affectsRoutes).toBe(true);
  });

  test('multiple impacts: highest risk wins', () => {
    const files = [
      makeFile('src/utils.js'),         // low
      makeFile('routes/v1/apps.js'),     // medium (routes)
      makeFile('libs/authenticate.js')   // critical (auth)
    ];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.level).toBe('critical');
    expect(result.affectsAuth).toBe(true);
    expect(result.affectsRoutes).toBe(true);
  });

  test('summary is non-empty for medium+ impact', () => {
    const files = [makeFile('routes/v1/data-sources.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.level).not.toBe('low');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  test('summary is empty for low impact', () => {
    const files = [makeFile('src/helpers/format.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.level).toBe('low');
    expect(result.summary).toBe('');
  });

  test('PR touching libs/database.js is critical', () => {
    const files = [makeFile('libs/database.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.level).toBe('critical');
    expect(result.criticalFileCount).toBeGreaterThanOrEqual(1);
  });

  test('PR touching libs/crypt.js is critical (security)', () => {
    const files = [makeFile('libs/crypt.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(result.level).toBe('critical');
  });

  test('PR touching libs/billing.js is high', () => {
    const files = [makeFile('libs/billing.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    expect(['critical', 'high']).toContain(result.level);
    expect(result.highFileCount).toBeGreaterThanOrEqual(1);
  });

  test('deduplicates impacts by file+category', () => {
    // libs/guards.js matches both authentication and security in architecture
    const files = [makeFile('libs/guards.js')];
    const result = assessPlatformImpact(files, 'fliplet-api');
    // Should not have duplicate file+category entries
    const keys = result.impacts.map(i => `${i.file}:${i.category}`);
    const uniqueKeys = [...new Set(keys)];
    expect(keys.length).toBe(uniqueKeys.length);
  });

  test('empty files array returns low impact', () => {
    const result = assessPlatformImpact([], 'fliplet-api');
    expect(result.level).toBe('low');
    expect(result.impacts).toHaveLength(0);
  });
});
