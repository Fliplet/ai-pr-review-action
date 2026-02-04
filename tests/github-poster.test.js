'use strict';

const {
  mapApprovalToEvent,
  buildReviewBody,
  buildReviewComments,
  buildImpactBanner,
  buildStatusBadge,
  buildWalkthroughTable,
  buildTipsSection,
  buildLabelSuggestions,
  buildRelatedIssues
} = require('../src/github-poster');

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

describe('buildReviewBody with platformImpact', () => {
  test('includes impact banner for critical level', () => {
    const body = buildReviewBody(
      { summary: 'Auth changes found.', comments: [] },
      { level: 'critical', affectsAuth: true, affectsMiddleware: false, affectsSchema: false, affectsData: false, affectsRoutes: false, affectsDependencies: false }
    );
    expect(body).toContain('Platform Impact: CRITICAL');
    expect(body).toContain('Authentication');
  });

  test('includes impact banner for high level', () => {
    const body = buildReviewBody(
      { summary: 'Data changes.', comments: [] },
      { level: 'high', affectsAuth: false, affectsMiddleware: false, affectsSchema: false, affectsData: true, affectsRoutes: true, affectsDependencies: false }
    );
    expect(body).toContain('Platform Impact: HIGH');
    expect(body).toContain('Data Sources');
    expect(body).toContain('API Routes');
  });

  test('no banner for low impact', () => {
    const body = buildReviewBody(
      { summary: 'All good.', comments: [] },
      { level: 'low', affectsAuth: false, affectsMiddleware: false, affectsSchema: false, affectsData: false, affectsRoutes: false, affectsDependencies: false }
    );
    expect(body).not.toContain('Platform Impact');
  });

  test('no banner when platformImpact is undefined', () => {
    const body = buildReviewBody({ summary: 'All good.', comments: [] });
    expect(body).not.toContain('Platform Impact');
  });
});

describe('buildImpactBanner', () => {
  test('critical banner uses alarm emoji', () => {
    const banner = buildImpactBanner({
      level: 'critical',
      affectsAuth: true,
      affectsMiddleware: true,
      affectsSchema: false,
      affectsData: false,
      affectsRoutes: false,
      affectsDependencies: false
    });
    expect(banner).toContain('🚨');
    expect(banner).toContain('CRITICAL');
    expect(banner).toContain('Authentication');
    expect(banner).toContain('Middleware');
  });

  test('high banner uses warning emoji', () => {
    const banner = buildImpactBanner({
      level: 'high',
      affectsAuth: false,
      affectsMiddleware: false,
      affectsSchema: false,
      affectsData: true,
      affectsRoutes: false,
      affectsDependencies: false
    });
    expect(banner).toContain('⚠️');
    expect(banner).toContain('HIGH');
  });

  test('medium banner uses info emoji', () => {
    const banner = buildImpactBanner({
      level: 'medium',
      affectsAuth: false,
      affectsMiddleware: false,
      affectsSchema: false,
      affectsData: false,
      affectsRoutes: true,
      affectsDependencies: false
    });
    expect(banner).toContain('ℹ️');
    expect(banner).toContain('MEDIUM');
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

describe('buildStatusBadge', () => {
  test('returns APPROVED badge for approve', () => {
    const badge = buildStatusBadge({
      approval: 'approve',
      comments: []
    });
    expect(badge).toContain('APPROVED');
    expect(badge).toContain('No critical issues found');
  });

  test('returns CHANGES REQUESTED badge for request_changes', () => {
    const badge = buildStatusBadge({
      approval: 'request_changes',
      comments: [
        { severity: 'critical', path: 'a.js', line: 1, body: 'XSS' }
      ]
    });
    expect(badge).toContain('CHANGES REQUESTED');
    expect(badge).toContain('1 critical issue');
  });

  test('returns NEEDS ATTENTION badge for comment', () => {
    const badge = buildStatusBadge({
      approval: 'comment',
      comments: [
        { severity: 'warning', path: 'a.js', line: 1, body: 'Issue' },
        { severity: 'warning', path: 'b.js', line: 2, body: 'Issue' }
      ]
    });
    expect(badge).toContain('NEEDS ATTENTION');
    expect(badge).toContain('2 warnings');
  });

  test('shows suggestion count when only suggestions', () => {
    const badge = buildStatusBadge({
      approval: 'comment',
      comments: [
        { severity: 'suggestion', path: 'a.js', line: 1, body: 'Tip' }
      ]
    });
    expect(badge).toContain('1 suggestion');
  });

  test('shows critical count in CHANGES REQUESTED when multiple criticals', () => {
    const badge = buildStatusBadge({
      approval: 'request_changes',
      comments: [
        { severity: 'critical', path: 'a.js', line: 1, body: 'XSS' },
        { severity: 'critical', path: 'b.js', line: 2, body: 'Injection' }
      ]
    });
    expect(badge).toContain('2 critical issues');
  });
});

describe('buildWalkthroughTable', () => {
  test('returns table structure for empty array', () => {
    const table = buildWalkthroughTable([]);
    expect(table).toContain('Walkthrough');
    expect(table).toContain('File | Changes');
  });

  test('builds table with file summaries', () => {
    const table = buildWalkthroughTable([
      { path: 'src/app.js', summary: 'Added error handling' },
      { path: 'src/utils.js', summary: 'Refactored helper functions' }
    ]);
    expect(table).toContain('Walkthrough');
    expect(table).toContain('src/app.js');
    expect(table).toContain('Added error handling');
    expect(table).toContain('src/utils.js');
    expect(table).toContain('Refactored helper functions');
  });

  test('caps at 10 files and shows overflow', () => {
    const files = Array.from({ length: 15 }, (_, i) => ({
      path: `file${i}.js`,
      summary: `Change ${i}`
    }));
    const table = buildWalkthroughTable(files);
    expect(table).toContain('file0.js');
    expect(table).toContain('file9.js');
    expect(table).not.toContain('file10.js');
    expect(table).toContain('+5 more files');
  });

  test('escapes pipe characters in paths and summaries', () => {
    const table = buildWalkthroughTable([
      { path: 'file|name.js', summary: 'Changed | operator' }
    ]);
    expect(table).toContain('file\\|name.js');
    expect(table).toContain('Changed \\| operator');
  });

  test('uses default summary when missing', () => {
    const table = buildWalkthroughTable([
      { path: 'file.js', summary: null }
    ]);
    expect(table).toContain('Modified');
  });
});

describe('buildTipsSection', () => {
  test('returns section header for empty array', () => {
    const section = buildTipsSection([]);
    expect(section).toContain('Tips');
    expect(section).not.toContain('**');
  });

  test('builds section with tips', () => {
    const section = buildTipsSection([
      { id: 'tip1', title: 'Tip Title', description: 'Tip description here.' }
    ]);
    expect(section).toContain('Tips');
    expect(section).toContain('**Tip Title**');
    expect(section).toContain('Tip description here.');
  });

  test('limits to 2 tips', () => {
    const section = buildTipsSection([
      { id: 'tip1', title: 'Tip 1', description: 'Desc 1' },
      { id: 'tip2', title: 'Tip 2', description: 'Desc 2' },
      { id: 'tip3', title: 'Tip 3', description: 'Desc 3' }
    ]);
    expect(section).toContain('Tip 1');
    expect(section).toContain('Tip 2');
    expect(section).not.toContain('Tip 3');
  });
});

describe('buildLabelSuggestions', () => {
  test('returns section with no labels for empty array', () => {
    const section = buildLabelSuggestions([]);
    expect(section).toContain('Suggested Labels');
    expect(section).not.toContain('`');
  });

  test('formats labels with backticks', () => {
    const section = buildLabelSuggestions(['bug', 'security', 'needs-tests']);
    expect(section).toContain('Suggested Labels');
    expect(section).toContain('`bug`');
    expect(section).toContain('`security`');
    expect(section).toContain('`needs-tests`');
  });

  test('separates labels with spaces', () => {
    const section = buildLabelSuggestions(['a', 'b']);
    expect(section).toContain('`a` `b`');
  });
});

describe('buildRelatedIssues', () => {
  test('returns section with no links for empty array', () => {
    const section = buildRelatedIssues([]);
    expect(section).toContain('Related Issues');
    expect(section).not.toContain('[');
  });

  test('builds links for Jira issues', () => {
    const section = buildRelatedIssues([
      { id: 'DEV-847', url: 'https://weboo.atlassian.net/browse/DEV-847', type: 'jira' }
    ]);
    expect(section).toContain('Related Issues');
    expect(section).toContain('[DEV-847](https://weboo.atlassian.net/browse/DEV-847)');
  });

  test('builds links for GitHub issues', () => {
    const section = buildRelatedIssues([
      { id: '#123', url: 'https://github.com/Fliplet/repo/issues/123', type: 'github' }
    ]);
    expect(section).toContain('[#123](https://github.com/Fliplet/repo/issues/123)');
  });

  test('handles multiple issues', () => {
    const section = buildRelatedIssues([
      { id: 'DEV-100', url: 'https://weboo.atlassian.net/browse/DEV-100', type: 'jira' },
      { id: 'PS-200', url: 'https://weboo.atlassian.net/browse/PS-200', type: 'jira' }
    ]);
    expect(section).toContain('DEV-100');
    expect(section).toContain('PS-200');
  });
});

describe('buildReviewBody with enhanced options', () => {
  test('handles undefined options parameter gracefully', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null
    );
    expect(body).toContain('APPROVED');
    expect(body).not.toContain('Walkthrough');
    expect(body).not.toContain('Tips');
  });

  test('handles null values in options gracefully', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      { fileSummaries: null, tips: null, suggestedLabels: null, relatedIssues: null }
    );
    expect(body).toContain('APPROVED');
    expect(body).not.toContain('Walkthrough');
    expect(body).not.toContain('Tips');
    expect(body).not.toContain('Suggested Labels');
    expect(body).not.toContain('Related Issues');
  });

  test('handles empty arrays in options without crashing', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      { fileSummaries: [], tips: [], suggestedLabels: [], relatedIssues: [] }
    );
    expect(body).toContain('APPROVED');
    expect(body).not.toContain('Walkthrough');
    expect(body).not.toContain('Tips');
    expect(body).not.toContain('Suggested Labels');
    expect(body).not.toContain('Related Issues');
  });

  test('includes status badge at top', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      {}
    );
    expect(body).toContain('APPROVED');
  });

  test('includes walkthrough table when provided', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      {
        fileSummaries: [
          { path: 'src/app.js', summary: 'Fixed bug' }
        ]
      }
    );
    expect(body).toContain('Walkthrough');
    expect(body).toContain('Fixed bug');
  });

  test('includes tips when provided', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      {
        tips: [{ id: 't1', title: 'My Tip', description: 'Tip content' }]
      }
    );
    expect(body).toContain('My Tip');
  });

  test('includes suggested labels when provided', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      {
        suggestedLabels: ['bug', 'security']
      }
    );
    expect(body).toContain('`bug`');
    expect(body).toContain('`security`');
  });

  test('includes related issues when provided', () => {
    const body = buildReviewBody(
      { summary: 'Good.', approval: 'approve', comments: [] },
      null,
      {
        relatedIssues: [{ id: 'DEV-847', url: 'https://example.com/DEV-847', type: 'jira' }]
      }
    );
    expect(body).toContain('DEV-847');
  });

  test('includes all sections in correct order', () => {
    const body = buildReviewBody(
      { summary: 'Good code.', approval: 'comment', comments: [{ severity: 'suggestion', path: 'a.js', line: 1, body: 'x' }] },
      { level: 'medium', affectsRoutes: true },
      {
        fileSummaries: [{ path: 'a.js', summary: 'Changed' }],
        tips: [{ id: 't', title: 'Tip', description: 'desc' }],
        suggestedLabels: ['label'],
        relatedIssues: [{ id: 'DEV-1', url: 'http://x', type: 'jira' }]
      }
    );

    const walkthroughPos = body.indexOf('Walkthrough');
    const impactPos = body.indexOf('Platform Impact');
    const summaryPos = body.indexOf('Good code');
    const tipsPos = body.indexOf('Tips');
    const labelsPos = body.indexOf('Suggested Labels');
    const issuesPos = body.indexOf('Related Issues');

    // Verify order: walkthrough < impact < summary < tips < labels < issues
    expect(walkthroughPos).toBeLessThan(impactPos);
    expect(impactPos).toBeLessThan(summaryPos);
    expect(summaryPos).toBeLessThan(tipsPos);
    expect(tipsPos).toBeLessThan(labelsPos);
    expect(labelsPos).toBeLessThan(issuesPos);
  });
});
