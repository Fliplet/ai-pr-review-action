'use strict';

const { mapApprovalToEvent, buildReviewBody, buildReviewComments } = require('../src/github-poster');

describe('mapApprovalToEvent', () => {
  test('maps approve to APPROVE', () => {
    expect(mapApprovalToEvent('approve', 'can-request-changes')).toBe('APPROVE');
    expect(mapApprovalToEvent('approve', 'comment-only')).toBe('APPROVE');
  });

  test('maps request_changes to REQUEST_CHANGES when allowed', () => {
    expect(mapApprovalToEvent('request_changes', 'can-request-changes')).toBe('REQUEST_CHANGES');
  });

  test('downgrades request_changes to COMMENT when not allowed', () => {
    expect(mapApprovalToEvent('request_changes', 'comment-only')).toBe('COMMENT');
  });

  test('maps comment to COMMENT', () => {
    expect(mapApprovalToEvent('comment', 'can-request-changes')).toBe('COMMENT');
  });

  test('defaults unknown values to COMMENT', () => {
    expect(mapApprovalToEvent('unknown', 'can-request-changes')).toBe('COMMENT');
  });
});

describe('buildReviewBody', () => {
  test('includes summary and footer', () => {
    const body = buildReviewBody({
      summary: 'Code looks good overall.',
      comments: []
    });
    expect(body).toContain('AI Code Review');
    expect(body).toContain('Code looks good overall.');
    expect(body).toContain('Powered by Claude AI');
  });

  test('includes severity table when there are comments', () => {
    const body = buildReviewBody({
      summary: 'Issues found.',
      comments: [
        { severity: 'critical', path: 'a.js', line: 1, body: 'XSS' },
        { severity: 'critical', path: 'b.js', line: 2, body: 'SQL injection' },
        { severity: 'warning', path: 'c.js', line: 3, body: 'No error handling' },
        { severity: 'suggestion', path: 'd.js', line: 4, body: 'Use const' }
      ]
    });
    expect(body).toContain('Critical | 2');
    expect(body).toContain('Warning | 1');
    expect(body).toContain('Suggestion | 1');
  });

  test('omits severity table when no comments', () => {
    const body = buildReviewBody({
      summary: 'All good.',
      comments: []
    });
    expect(body).not.toContain('Severity');
    expect(body).not.toContain('Count');
  });

  test('omits zero-count severities', () => {
    const body = buildReviewBody({
      summary: 'Minor issue.',
      comments: [
        { severity: 'suggestion', path: 'a.js', line: 1, body: 'Prefer const' }
      ]
    });
    expect(body).not.toContain('Critical');
    expect(body).not.toContain('Warning');
    expect(body).toContain('Suggestion | 1');
  });
});

describe('buildReviewComments', () => {
  const diffFiles = [
    {
      path: 'src/app.js',
      hunks: [{
        changes: [
          { type: 'addition', content: 'const x = 1;', line: 10 },
          { type: 'addition', content: 'const y = 2;', line: 11 },
          { type: 'context', content: 'const z = 3;', oldLine: 5, newLine: 12 }
        ]
      }]
    },
    {
      path: 'src/utils.js',
      hunks: [{
        changes: [
          { type: 'addition', content: 'export default {};', line: 1 }
        ]
      }]
    }
  ];

  test('includes comments on valid diff lines', () => {
    const comments = [
      { path: 'src/app.js', line: 10, severity: 'warning', body: 'Missing validation' }
    ];
    const result = buildReviewComments(comments, diffFiles);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/app.js');
    expect(result[0].line).toBe(10);
    expect(result[0].side).toBe('RIGHT');
  });

  test('filters out comments on lines not in diff', () => {
    const comments = [
      { path: 'src/app.js', line: 999, severity: 'warning', body: 'Not in diff' }
    ];
    const result = buildReviewComments(comments, diffFiles);
    expect(result).toHaveLength(0);
  });

  test('filters out comments on unknown files', () => {
    const comments = [
      { path: 'unknown.js', line: 1, severity: 'warning', body: 'Unknown file' }
    ];
    const result = buildReviewComments(comments, diffFiles);
    expect(result).toHaveLength(0);
  });

  test('filters out comments on context lines (not additions)', () => {
    const comments = [
      { path: 'src/app.js', line: 12, severity: 'suggestion', body: 'On context line' }
    ];
    const result = buildReviewComments(comments, diffFiles);
    expect(result).toHaveLength(0); // line 12 is a context line, not an addition
  });

  test('handles multiple valid comments across files', () => {
    const comments = [
      { path: 'src/app.js', line: 10, severity: 'critical', body: 'Issue 1' },
      { path: 'src/app.js', line: 11, severity: 'warning', body: 'Issue 2' },
      { path: 'src/utils.js', line: 1, severity: 'suggestion', body: 'Issue 3' }
    ];
    const result = buildReviewComments(comments, diffFiles);
    expect(result).toHaveLength(3);
  });
});
