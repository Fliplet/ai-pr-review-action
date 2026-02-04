'use strict';

const { estimateTokens, truncateDiff, formatDiffForPrompt, formatFileForPrompt, isSecurityFile, isCoreFile, filePriority } = require('../src/token-budget');

describe('estimateTokens', () => {
  test('returns 0 for empty or null input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  test('estimates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('a')).toBe(1); // ceil(1/4) = 1
  });
});

describe('isSecurityFile', () => {
  test('detects auth files', () => {
    expect(isSecurityFile('src/auth.js')).toBe(true);
    expect(isSecurityFile('lib/authentication.js')).toBe(true);
  });

  test('detects middleware files', () => {
    expect(isSecurityFile('middleware/cors.js')).toBe(true);
    expect(isSecurityFile('src/middleware.js')).toBe(true);
  });

  test('detects route files', () => {
    expect(isSecurityFile('routes/api.js')).toBe(true);
    expect(isSecurityFile('src/route/users.js')).toBe(true);
  });

  test('detects session/token files', () => {
    expect(isSecurityFile('lib/session.js')).toBe(true);
    expect(isSecurityFile('src/token-manager.js')).toBe(true);
  });

  test('does not flag regular files', () => {
    expect(isSecurityFile('src/utils.js')).toBe(false);
    expect(isSecurityFile('css/style.css')).toBe(false);
    expect(isSecurityFile('build.html')).toBe(false);
  });
});

describe('truncateDiff', () => {
  function makeFile(path, additions, deletions) {
    return {
      path,
      status: 'modified',
      additions,
      deletions,
      hunks: [{
        header: `@@ -1,${deletions} +1,${additions} @@`,
        changes: [
          ...Array.from({ length: additions }, (_, i) => ({
            type: 'addition',
            content: `line ${i + 1}`,
            line: i + 1
          })),
          ...Array.from({ length: deletions }, (_, i) => ({
            type: 'deletion',
            content: `old line ${i + 1}`,
            line: i + 1
          }))
        ]
      }]
    };
  }

  test('handles empty file list gracefully', () => {
    const result = truncateDiff([], 10000);
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
    expect(result.includedFiles).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.estimatedTokens).toBe(0);
  });

  test('handles single file at exact token limit', () => {
    const file = makeFile('exact.js', 1, 0);
    const fileText = formatFileForPrompt(file);
    const exactTokens = estimateTokens(fileText);

    const result = truncateDiff([file], exactTokens);
    expect(result.includedFiles).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.files[0].path).toBe('exact.js');
  });

  test('handles single file just over token limit', () => {
    const file = makeFile('over.js', 10, 5);
    const fileText = formatFileForPrompt(file);
    const fileTokens = estimateTokens(fileText);

    // Set budget to just under what the file needs
    const result = truncateDiff([file], fileTokens - 1);
    // File should be truncated or excluded
    expect(result.truncated).toBe(true);
  });

  test('includes all files when within budget', () => {
    const files = [makeFile('a.js', 2, 1), makeFile('b.js', 3, 1)];
    const result = truncateDiff(files, 100000);
    expect(result.includedFiles).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test('prioritizes security files', () => {
    const files = [
      makeFile('src/utils.js', 5, 0),
      makeFile('src/auth.js', 5, 0)
    ];
    // Give just enough budget for one file
    const result = truncateDiff(files, 50);
    expect(result.files[0].path).toBe('src/auth.js');
  });

  test('continues past oversized files (bug fix)', () => {
    // Create one large file and one small file
    const largeFile = makeFile('large.js', 500, 500);
    const smallFile = makeFile('small.js', 1, 0);

    const result = truncateDiff([largeFile, smallFile], 200);
    // Should include the small file even though the large file was skipped
    const includedPaths = result.files.map(f => f.path);
    expect(includedPaths).toContain('small.js');
  });

  test('returns truncated flag when files are omitted', () => {
    const files = [makeFile('a.js', 100, 100)];
    const result = truncateDiff(files, 10); // Very small budget
    expect(result.truncated).toBe(true);
    expect(result.totalFiles).toBe(1);
  });

  test('sorts by priority descending (largest change volume first)', () => {
    const files = [
      makeFile('big.js', 50, 50),
      makeFile('small.js', 1, 0),
      makeFile('medium.js', 10, 5)
    ];
    const result = truncateDiff(files, 100000);
    expect(result.files[0].path).toBe('big.js');
    expect(result.files[1].path).toBe('medium.js');
    expect(result.files[2].path).toBe('small.js');
  });
});

describe('formatFileForPrompt', () => {
  test('includes file path and change counts', () => {
    const file = {
      path: 'src/app.js',
      status: 'modified',
      additions: 3,
      deletions: 1,
      hunks: []
    };
    const output = formatFileForPrompt(file);
    expect(output).toContain('### src/app.js');
    expect(output).toContain('(+3/-1)');
  });

  test('includes status label for new files', () => {
    const file = {
      path: 'src/new.js',
      status: 'added',
      additions: 5,
      deletions: 0,
      hunks: []
    };
    const output = formatFileForPrompt(file);
    expect(output).toContain('[added]');
  });

  test('does not include status label for modified files', () => {
    const file = {
      path: 'src/app.js',
      status: 'modified',
      additions: 1,
      deletions: 1,
      hunks: []
    };
    const output = formatFileForPrompt(file);
    expect(output).not.toContain('[modified]');
  });

  test('formats hunk changes correctly', () => {
    const file = {
      path: 'app.js',
      status: 'modified',
      additions: 1,
      deletions: 1,
      hunks: [{
        header: '@@ -1,2 +1,2 @@',
        changes: [
          { type: 'deletion', content: 'old code', line: 1 },
          { type: 'addition', content: 'new code', line: 1 },
          { type: 'context', content: 'same', oldLine: 2, newLine: 2 }
        ]
      }]
    };
    const output = formatFileForPrompt(file);
    expect(output).toContain('-old code');
    expect(output).toContain('+new code');
    expect(output).toContain(' same');
  });
});

describe('formatDiffForPrompt', () => {
  test('adds truncation note when files are omitted', () => {
    const budgetResult = {
      files: [],
      totalFiles: 5,
      includedFiles: 2,
      truncated: true,
      estimatedTokens: 1000
    };
    const output = formatDiffForPrompt(budgetResult);
    expect(output).toContain('3 file(s) omitted');
  });

  test('does not add note when all files included', () => {
    const budgetResult = {
      files: [],
      totalFiles: 2,
      includedFiles: 2,
      truncated: false,
      estimatedTokens: 500
    };
    const output = formatDiffForPrompt(budgetResult);
    expect(output).not.toContain('omitted');
  });
});

describe('isCoreFile', () => {
  test('detects index.js', () => {
    expect(isCoreFile('src/index.js')).toBe(true);
  });

  test('detects app.js', () => {
    expect(isCoreFile('app.js')).toBe(true);
  });

  test('detects server.js', () => {
    expect(isCoreFile('server.js')).toBe(true);
  });

  test('does not flag regular files', () => {
    expect(isCoreFile('src/utils.js')).toBe(false);
    expect(isCoreFile('lib/helpers.js')).toBe(false);
  });
});

describe('filePriority', () => {
  test('security files get +1000 priority', () => {
    const securityFile = { path: 'src/auth.js', additions: 5, deletions: 2 };
    const regularFile = { path: 'src/utils.js', additions: 5, deletions: 2 };
    expect(filePriority(securityFile)).toBeGreaterThan(filePriority(regularFile));
    expect(filePriority(securityFile)).toBe(1000 + 7);
    expect(filePriority(regularFile)).toBe(7);
  });

  test('core files get +500 priority', () => {
    const coreFile = { path: 'src/index.js', additions: 3, deletions: 1 };
    const regularFile = { path: 'src/helpers.js', additions: 3, deletions: 1 };
    expect(filePriority(coreFile)).toBe(500 + 4);
    expect(filePriority(regularFile)).toBe(4);
  });

  test('security + core file gets both bonuses', () => {
    // A file matching both patterns (e.g. routes/index.js)
    const bothFile = { path: 'routes/index.js', additions: 10, deletions: 5 };
    expect(filePriority(bothFile)).toBe(1000 + 500 + 15);
  });

  test('security files sort before large non-security files', () => {
    const smallSecurity = { path: 'src/auth.js', additions: 2, deletions: 1 };
    const largeRegular = { path: 'src/bigfile.js', additions: 200, deletions: 100 };
    expect(filePriority(smallSecurity)).toBeGreaterThan(filePriority(largeRegular));
  });
});
