'use strict';

const { detectIssues, extractPrimaryTicket, JIRA_PREFIXES, JIRA_BASE_URL } = require('../src/issue-detector');

describe('detectIssues', () => {
  test('returns empty array when no issues found', () => {
    const issues = detectIssues({
      prTitle: 'Simple update',
      prBody: 'No ticket reference here',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(0);
  });

  test('detects DEV ticket in PR title', () => {
    const issues = detectIssues({
      prTitle: 'DEV-847: Fix memory leak',
      prBody: '',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('DEV-847');
    expect(issues[0].type).toBe('jira');
    expect(issues[0].url).toBe(`${JIRA_BASE_URL}/DEV-847`);
  });

  test('detects PS ticket in PR body', () => {
    const issues = detectIssues({
      prTitle: 'Update feature',
      prBody: 'This fixes PS-1234 reported by customer',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('PS-1234');
    expect(issues[0].type).toBe('jira');
  });

  test('detects multiple Jira tickets', () => {
    const issues = detectIssues({
      prTitle: 'DEV-100: Update',
      prBody: 'Related to PS-200 and SEC-50',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(3);
    const ids = issues.map(i => i.id);
    expect(ids).toContain('DEV-100');
    expect(ids).toContain('PS-200');
    expect(ids).toContain('SEC-50');
  });

  test('deduplicates repeated ticket references', () => {
    const issues = detectIssues({
      prTitle: 'DEV-847: Fix bug',
      prBody: 'As mentioned in DEV-847, this needs to be fixed. DEV-847 is critical.',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('DEV-847');
  });

  test('detects GitHub issue reference', () => {
    const issues = detectIssues({
      prTitle: 'Fix #123',
      prBody: '',
      owner: 'Fliplet',
      repo: 'fliplet-api'
    });
    const ghIssue = issues.find(i => i.type === 'github');
    expect(ghIssue).toBeDefined();
    expect(ghIssue.id).toBe('#123');
    expect(ghIssue.url).toBe('https://github.com/Fliplet/fliplet-api/issues/123');
  });

  test('detects tickets in commit messages', () => {
    const issues = detectIssues({
      prTitle: 'Update',
      prBody: '',
      commitMessages: ['DEV-999: Initial commit', 'Fix typo'],
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('DEV-999');
  });

  test('detects tickets in diff', () => {
    const issues = detectIssues({
      prTitle: 'Update',
      prBody: '',
      diff: '// TODO: DEV-500 needs follow-up',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('DEV-500');
  });

  test('handles case-insensitive ticket prefixes', () => {
    const issues = detectIssues({
      prTitle: 'dev-123: Fix',
      prBody: 'ps-456 related',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(2);
    expect(issues.some(i => i.id === 'DEV-123')).toBe(true);
    expect(issues.some(i => i.id === 'PS-456')).toBe(true);
  });

  test('sorts Jira issues before GitHub issues', () => {
    const issues = detectIssues({
      prTitle: 'Fix #50 and DEV-100',
      prBody: '',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues[0].type).toBe('jira');
    expect(issues[1].type).toBe('github');
  });

  test('detects all supported Jira prefixes', () => {
    JIRA_PREFIXES.forEach(prefix => {
      const issues = detectIssues({
        prTitle: `${prefix}-999: Test`,
        prBody: '',
        owner: 'test',
        repo: 'repo'
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe(`${prefix}-999`);
    });
  });

  test('does not detect invalid ticket formats', () => {
    const issues = detectIssues({
      prTitle: 'Update DEV- file',
      prBody: 'NOTAPREFIX-123 and DEV without number',
      owner: 'test',
      repo: 'repo'
    });
    expect(issues).toHaveLength(0);
  });

  test('requires owner and repo for GitHub issues', () => {
    const issues = detectIssues({
      prTitle: 'Fix #123',
      prBody: '',
      owner: null,
      repo: null
    });
    const ghIssue = issues.find(i => i.type === 'github');
    expect(ghIssue).toBeUndefined();
  });
});

describe('extractPrimaryTicket', () => {
  test('returns null for empty title', () => {
    expect(extractPrimaryTicket('')).toBeNull();
    expect(extractPrimaryTicket(null)).toBeNull();
    expect(extractPrimaryTicket(undefined)).toBeNull();
  });

  test('extracts ticket at start of title', () => {
    expect(extractPrimaryTicket('DEV-847: Fix memory leak')).toBe('DEV-847');
    expect(extractPrimaryTicket('PS-100 - Add feature')).toBe('PS-100');
  });

  test('extracts ticket anywhere in title if not at start', () => {
    expect(extractPrimaryTicket('Fix memory leak (DEV-847)')).toBe('DEV-847');
    expect(extractPrimaryTicket('Related to PS-100 issue')).toBe('PS-100');
  });

  test('prefers ticket at start over ticket elsewhere', () => {
    expect(extractPrimaryTicket('DEV-100: Fix PS-200 related issue')).toBe('DEV-100');
  });

  test('handles case-insensitive prefixes', () => {
    expect(extractPrimaryTicket('dev-123: Fix')).toBe('DEV-123');
  });

  test('returns first match when multiple tickets at start', () => {
    // Should return DEV-100 as it's at the very start
    const result = extractPrimaryTicket('DEV-100 PS-200: Fix');
    expect(result).toBe('DEV-100');
  });
});

describe('constants', () => {
  test('JIRA_PREFIXES includes expected values', () => {
    expect(JIRA_PREFIXES).toContain('DEV');
    expect(JIRA_PREFIXES).toContain('PS');
    expect(JIRA_PREFIXES).toContain('SEC');
  });

  test('JIRA_BASE_URL is valid', () => {
    expect(JIRA_BASE_URL).toBe('https://weboo.atlassian.net/browse');
  });
});
