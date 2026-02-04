'use strict';

const { generateTips, getTipDefinitions } = require('../src/tips-generator');

describe('generateTips', () => {
  test('returns empty array for empty diff', () => {
    expect(generateTips('')).toHaveLength(0);
    expect(generateTips(null)).toHaveLength(0);
    expect(generateTips(undefined)).toHaveLength(0);
  });

  test('detects try/finally pattern', () => {
    const diff = `
+    try {
+      await doSomething();
+    } finally {
+      cleanup();
+    }
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'try-finally')).toBe(true);
    expect(tips[0].title).toBe('try/finally for cleanup');
    expect(tips[0].description).toContain('finally');
  });

  test('detects async/await pattern', () => {
    const diff = `
+async function fetchData() {
+  const result = await fetch('/api');
+  return result;
+}
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'async-await')).toBe(true);
  });

  test('detects async arrow function', () => {
    const diff = `
+const handler = async (req, res) => {
+  await doWork();
+};
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'async-await')).toBe(true);
  });

  test('detects Express middleware pattern', () => {
    const diff = `
+app.use(authMiddleware);
+router.get('/users', handler);
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'middleware')).toBe(true);
  });

  test('detects route definition via middleware pattern', () => {
    // Note: route definitions match the middleware pattern first,
    // so we expect middleware tip to be generated (not route-validation separately)
    const diff = `
+router.post('/api/users', async (req, res) => {
+  const user = req.body;
+});
    `;
    const tips = generateTips(diff);
    // Middleware pattern matches router.post, so we expect middleware tip
    expect(tips.some(t => t.id === 'middleware')).toBe(true);
  });

  test('detects Promise.all pattern', () => {
    const diff = `
+const results = await Promise.all([
+  fetchUsers(),
+  fetchPosts()
+]);
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'promise-all')).toBe(true);
  });

  test('detects parameterized SQL queries', () => {
    const diff = `
+const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'sql-params')).toBe(true);
  });

  test('detects environment variable usage', () => {
    const diff = `
+const apiKey = process.env.API_KEY;
+const dbUrl = process.env.DATABASE_URL;
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'env-vars')).toBe(true);
  });

  test('detects transaction patterns', () => {
    const diff = `
+await sequelize.transaction(async (t) => {
+  await User.create({ name: 'John' }, { transaction: t });
+});
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'transaction')).toBe(true);
  });

  test('detects spread operator usage', () => {
    const diff = `
+const newObj = { ...oldObj, updated: true };
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'spread-operator')).toBe(true);
  });

  test('detects Fliplet.Storage usage', () => {
    const diff = `
+Fliplet.Storage.get('userPrefs').then(prefs => {
+  console.log(prefs);
+});
    `;
    const tips = generateTips(diff);
    expect(tips.some(t => t.id === 'fliplet-storage')).toBe(true);
  });

  test('returns maximum 2 tips', () => {
    const diff = `
+async function handler() {
+  try {
+    await Promise.all([task1(), task2()]);
+    app.use(middleware);
+    router.get('/route', fn);
+  } finally {
+    cleanup();
+  }
+}
    `;
    const tips = generateTips(diff);
    expect(tips.length).toBeLessThanOrEqual(2);
  });

  test('returns tips in pattern order', () => {
    // try/finally comes before async/await in definitions
    const diff = `
+async function fn() {
+  try {
+    await work();
+  } finally {
+    done();
+  }
+}
    `;
    const tips = generateTips(diff);
    expect(tips[0].id).toBe('try-finally');
  });

  test('each tip has required properties', () => {
    const diff = `
+async function test() {
+  try { } finally { }
+}
    `;
    const tips = generateTips(diff);
    tips.forEach(tip => {
      expect(tip).toHaveProperty('id');
      expect(tip).toHaveProperty('title');
      expect(tip).toHaveProperty('description');
      expect(typeof tip.id).toBe('string');
      expect(typeof tip.title).toBe('string');
      expect(typeof tip.description).toBe('string');
      expect(tip.description.length).toBeGreaterThan(0);
    });
  });
});

describe('getTipDefinitions', () => {
  test('returns array of tip definitions', () => {
    const definitions = getTipDefinitions();
    expect(Array.isArray(definitions)).toBe(true);
    expect(definitions.length).toBeGreaterThan(0);
  });

  test('each definition has required properties', () => {
    const definitions = getTipDefinitions();
    definitions.forEach(def => {
      expect(def).toHaveProperty('id');
      expect(def).toHaveProperty('pattern');
      expect(def).toHaveProperty('title');
      expect(def).toHaveProperty('description');
      expect(def.pattern instanceof RegExp).toBe(true);
    });
  });
});
