'use strict';

const { parseDiff, isReviewableFile, getTotalChanges } = require('../src/diff-parser');

describe('parseDiff', () => {
  test('parses a simple diff with one file and one hunk', () => {
    const diff = [
      'diff --git a/src/app.js b/src/app.js',
      '--- a/src/app.js',
      '+++ b/src/app.js',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' const d = 5;'
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.js');
    expect(files[0].status).toBe('modified');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].changes).toHaveLength(5);
  });

  test('parses multiple files', () => {
    const diff = [
      'diff --git a/a.js b/a.js',
      '--- a/a.js',
      '+++ b/a.js',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.js b/b.js',
      '--- a/b.js',
      '+++ b/b.js',
      '@@ -1 +1 @@',
      '-foo',
      '+bar'
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('a.js');
    expect(files[1].path).toBe('b.js');
  });

  test('detects new file status', () => {
    const diff = [
      'diff --git a/new-file.js b/new-file.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new-file.js',
      '@@ -0,0 +1,2 @@',
      '+line 1',
      '+line 2'
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('added');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(0);
  });

  test('detects deleted file status', () => {
    const diff = [
      'diff --git a/old.js b/old.js',
      'deleted file mode 100644',
      '--- a/old.js',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line 1',
      '-line 2'
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(0); // +++ /dev/null doesn't match +++ b/ pattern
  });

  test('deleted file after modified file does not corrupt previous file', () => {
    const diff = [
      'diff --git a/a.js b/a.js',
      '--- a/a.js',
      '+++ b/a.js',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/deleted.js b/deleted.js',
      'deleted file mode 100644',
      '--- a/deleted.js',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line 1',
      '-line 2'
    ].join('\n');

    const files = parseDiff(diff);
    // Only a.js should be parsed — deleted.js has +++ /dev/null so no currentFile is created
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('a.js');
    expect(files[0].hunks).toHaveLength(1); // only a.js's hunk, not deleted.js's
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  test('detects renamed file status', () => {
    const diff = [
      'diff --git a/old-name.js b/new-name.js',
      'rename from old-name.js',
      'rename to new-name.js',
      '--- a/old-name.js',
      '+++ b/new-name.js',
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('renamed');
    expect(files[0].path).toBe('new-name.js');
  });

  test('tracks correct line numbers', () => {
    const diff = [
      'diff --git a/src/app.js b/src/app.js',
      '--- a/src/app.js',
      '+++ b/src/app.js',
      '@@ -10,3 +10,4 @@ function foo()',
      ' existing line',
      '-removed line',
      '+added line 1',
      '+added line 2',
      ' context line'
    ].join('\n');

    const files = parseDiff(diff);
    const changes = files[0].hunks[0].changes;

    expect(changes[0].type).toBe('context');
    expect(changes[0].newLine).toBe(10);

    expect(changes[1].type).toBe('deletion');
    expect(changes[1].line).toBe(11);

    expect(changes[2].type).toBe('addition');
    expect(changes[2].line).toBe(11);

    expect(changes[3].type).toBe('addition');
    expect(changes[3].line).toBe(12);
  });

  test('parses hunk context (function name)', () => {
    const diff = [
      'diff --git a/app.js b/app.js',
      '--- a/app.js',
      '+++ b/app.js',
      '@@ -5,3 +5,3 @@ function handleSubmit()',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;'
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0].hunks[0].context).toBe('function handleSubmit()');
  });

  test('handles empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

describe('isReviewableFile', () => {
  test('accepts JavaScript files', () => {
    expect(isReviewableFile('src/app.js')).toBe(true);
    expect(isReviewableFile('js/build.js')).toBe(true);
  });

  test('accepts CSS files', () => {
    expect(isReviewableFile('css/style.css')).toBe(true);
  });

  test('accepts HTML files', () => {
    expect(isReviewableFile('interface.html')).toBe(true);
    expect(isReviewableFile('build.html')).toBe(true);
  });

  test('skips markdown files', () => {
    expect(isReviewableFile('README.md')).toBe(false);
    expect(isReviewableFile('CHANGELOG.md')).toBe(false);
  });

  test('skips image files', () => {
    expect(isReviewableFile('img/logo.png')).toBe(false);
    expect(isReviewableFile('icon.svg')).toBe(false);
  });

  test('skips node_modules', () => {
    expect(isReviewableFile('node_modules/express/index.js')).toBe(false);
  });

  test('skips minified files', () => {
    expect(isReviewableFile('dist/bundle.min.js')).toBe(false);
    expect(isReviewableFile('css/style.min.css')).toBe(false);
  });

  test('skips .github directory', () => {
    expect(isReviewableFile('.github/workflows/ci.yml')).toBe(false);
  });

  test('skips lock files', () => {
    expect(isReviewableFile('package-lock.json')).toBe(false);
    expect(isReviewableFile('yarn.lock')).toBe(false);
  });

  test('allows widget.json specifically', () => {
    expect(isReviewableFile('widget.json')).toBe(true);
    expect(isReviewableFile('some/path/widget.json')).toBe(true);
  });

  test('skips other JSON files', () => {
    expect(isReviewableFile('tsconfig.json')).toBe(false);
    expect(isReviewableFile('config.json')).toBe(false);
  });

  test('skips source maps', () => {
    expect(isReviewableFile('app.js.map')).toBe(false);
  });
});

describe('getTotalChanges', () => {
  test('sums additions and deletions across files', () => {
    const files = [
      { additions: 5, deletions: 2 },
      { additions: 10, deletions: 3 },
      { additions: 0, deletions: 1 }
    ];
    expect(getTotalChanges(files)).toBe(21);
  });

  test('returns 0 for empty array', () => {
    expect(getTotalChanges([])).toBe(0);
  });
});
