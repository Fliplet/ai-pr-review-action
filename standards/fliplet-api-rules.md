# Fliplet API (Backend) Specific Rules

These rules apply when reviewing PRs on `fliplet-api`. They supplement the base `fliplet-rules.md`.

---

## Express Route Patterns

### Middleware Chains

Every route file in fliplet-api follows a standard middleware pattern. Routes must use the correct authentication and preloader middleware.

**Standard route setup:**
```js
const express = require('express');
const router = express.Router();

const authenticate = require('../../libs/authenticate');
const preloaders = require('../../libs/preloaders');

// Authentication middleware — required on all routes
router.use(authenticate);

// Preload entities from route parameters
router.param('id', preloaders.app);
```

**Critical:** A route file missing `router.use(authenticate)` is a security vulnerability. Every route must authenticate requests unless explicitly documented as public.

**Role-based access control:**
```js
// Restrict entire route to users with a specific role
router.use(authenticate.hasAnyRoles('accessAuditLogs'));

// Restrict individual routes to organization admins
router.use((req, res, next) => {
  return authenticate.organizationAdmin(req, res, next);
});
```

**Violation — missing authentication:**
```js
// BAD: No authentication middleware
router.get('/data', async function(req, res) {
  const data = await req.db.models.dataSource.findAll();
  res.send({ data });
});
```

### Preloaders

Preloaders load entities (app, organization, user, dataSource, etc.) from request parameters and attach them to `req.fl*` properties.

```js
// Param-based preloaders — load entity from URL params
router.param('id', preloaders.app);           // req.flApp
router.param('user', preloaders.user);        // req.flUser
router.param('dataSourceId', preloaders.dataSource);  // req.flDataSource

// Query/body-based preloaders — load entity from query or body params
router.use(preloaders.param('appId', 'app', {
  attributes: ['id', 'name', 'organizationId', 'metrics', 'settings']
}));
router.use(preloaders.param('organizationId', 'organization'));
router.use(preloaders.param('dataSourceId', 'dataSource'));
router.use(preloaders.param('dataSourceEntryId', 'dataSourceEntry'));
```

**Warning:** Using `req.params.id` directly to query the database instead of using preloaders bypasses permission checks.

---

## Response Patterns

### Standard Response Methods

The API extends Express `res` with custom methods:

```js
// Success responses
res.send({ users });              // 200 with JSON body
res.json({ success: true });      // 200 with JSON body

// Error responses — use res.error() for consistent error format
res.error(400, error);            // Bad request with error object/string
res.error(403, { message: '...' }); // Forbidden with message
res.error(404, 'Not found');      // Not found
res.error(500, error);            // Server error

// Manual status responses (less preferred)
res.status(400).send({ message: 'Validation failed', errors });
res.status(400).json({ error: 'Name is required' });
```

**Violation — inconsistent error handling:**
```js
// BAD: Throwing errors without catching or using res.error()
router.post('/', async function(req, res) {
  const result = await db.models.item.create(req.body); // uncaught error
  res.json(result);
});
```

**Fix:**
```js
// GOOD: Proper try/catch with res.error()
router.post('/', async function(req, res) {
  try {
    const result = await db.models.item.create(req.body);
    res.json(result);
  } catch (error) {
    res.error(400, error);
  }
});
```

---

## Database Patterns (Sequelize)

### Query Patterns

The API uses Sequelize ORM with `req.db.models.*` access pattern:

```js
// Standard findAll with attributes and where clause
const users = await req.db.models.user.findAll({
  attributes: ['id', 'email', 'firstName', 'lastName'],
  where: { type: null },
  raw: true
});

// Aggregations use Sequelize.literal() and Sequelize.fn()
const counts = await db.models.log.findAll({
  raw: true,
  attributes: [
    'appId',
    [Sequelize.literal("COUNT(DISTINCT(data->'device'->'uuid'))"), 'licenseCount']
  ],
  where: logWhere,
  group: ['appId']
});

// Reader replica for read-heavy queries
const data = await req.db.reader().models.analyticsDailyUser.findAll({ ... });
```

**Critical — SQL injection via string concatenation:**
```js
// BAD: String concatenation in Sequelize literal
const results = await db.models.user.findAll({
  where: Sequelize.literal(`name = '${req.body.name}'`)
});
```

**Fix:**
```js
// GOOD: Use Sequelize replacements or where clauses
const results = await db.models.user.findAll({
  where: { name: req.body.name }
});
```

### Include Patterns (Joins)

```js
// Eager loading with associations
const logs = await db.models.log.findAll({
  include: [{
    model: req.db.models.app,
    required: true,         // INNER JOIN (false = LEFT JOIN)
    attributes: ['name'],
    paranoid: true           // Respect soft-deletes
  }, {
    model: req.db.models.user,
    required: false,
    attributes: ['firstName', 'lastName', 'email'],
    paranoid: true
  }]
});
```

**Warning:** Using `required: true` in includes makes it an INNER JOIN. Ensure this is intentional — it filters out records without associations.

---

## Core Libraries

### libs/authenticate.js

The authentication library provides middleware and helpers:

- `authenticate` — Express middleware, loads user from auth token
- `authenticate.loadUser` — App-level middleware for token preloading
- `authenticate.hasAnyRoles('roleName')` — Restrict to users with specific role
- `authenticate.organizationAdmin` — Restrict to org admins

**Violation — bypassing authentication:**
```js
// BAD: Checking user manually instead of using authenticate middleware
router.get('/data', function(req, res) {
  if (!req.headers.authorization) {
    return res.status(401).send('Unauthorized');
  }
  // ... process request
});
```

### libs/preloaders.js

Loads entities and attaches to `req.fl*`:
- `preloaders.app` → `req.flApp`
- `preloaders.user` → `req.flUser`
- `preloaders.dataSource` → `req.flDataSource`
- `preloaders.dataSourceEntry` → `req.flDataSourceEntry`
- `preloaders.organization` → `req.flOrganization`
- `preloaders.page` → `req.flPage`
- `preloaders.param(paramName, entityType, options)` — Load from query/body params

### libs/billing.js

Feature enforcement and billing checks:
```js
const { runFeatureEnforcements } = require('../../libs/billing');

const publishedApps = billing.runFeatureEnforcements({
  featureName: 'publishedApps',
});

// Use as middleware
router.use(publishedApps);
```

### libs/helpers.js

Common utilities:
- `addSecurityHeaders(app, res)` — Add security response headers

### libs/xssProtection.js

XSS sanitization:
```js
const { sanitizeXSS } = require('../../libs/xssProtection');
```

---

## Input Validation

### Request Validation Pattern

The API uses `express-validator` for request validation:

```js
router.post('/', function createApp(req, res) {
  req.sanitize('name').trim();
  req.checkBody(appCreateSchema);

  var errors = req.validationErrors();

  if (errors) {
    return res.status(400).send({
      message: 'Validation failed',
      errors
    });
  }

  // ... proceed with validated input
});
```

**Critical — using req.body without validation:**
```js
// BAD: Direct use of req.body fields without validation
router.post('/items', async function(req, res) {
  await db.models.item.create(req.body);
  res.json({ success: true });
});
```

**Fix:**
```js
// GOOD: Validate and pick only allowed fields
router.post('/items', async function(req, res) {
  const params = _.pick(req.body, ['name', 'description']);

  if (!params.name || typeof params.name !== 'string') {
    return res.error(400, 'Name is required');
  }

  await db.models.item.create(params);
  res.json({ success: true });
});
```

---

## Permission Checks

### Data Source Permissions

Data sources have granular permissions (`r`, `u`, `d`, `c`):

```js
if (!req.flDataSource.hasPermission('u')) {
  return res.status(400).send({
    message: 'Your role does not allow updating this data source.'
  });
}
```

### Organization Membership

```js
req.user.belongsToOrganization(req.body.organizationId)
  .then(function(belongs) {
    if (!belongs) {
      return res.status(400).send({
        message: 'User does not belong to organization'
      });
    }
    // ... proceed
  });
```

**Warning:** Always verify organization membership before creating resources scoped to an organization.

---

## Rate Limiting

```js
const bruteforce = require('../../libs/bruteforce');

// Apply rate limiting to routes
router.use(bruteforce.applyRateLimiting('organizationLogs', 30, 10));
```

---

## Async Route Handlers

**Warning — missing try/catch in async handlers:**
```js
// BAD: Unhandled rejection in async handler
router.get('/', async function(req, res) {
  const data = await req.db.models.item.findAll(); // may throw
  res.send(data);
});
```

**Fix:**
```js
// GOOD: Wrapped in try/catch
router.get('/', async function(req, res) {
  try {
    const data = await req.db.models.item.findAll();
    res.send(data);
  } catch (err) {
    res.error(400, err);
  }
});
```

---

## Translation Support

The API supports response translations via `res.translate()`:

```js
return res.error(403, {
  message: res.translate('api.customWebDomain.featureNotAvailable'),
  status: customWebDomain.domainStatus.FEATURE_NOT_AVAILABLE
});
```

**Suggestion:** User-facing error messages should use `res.translate()` with translation keys rather than hardcoded English strings.

---

## Module Exports

Route files export the Express router:

```js
// Standard route file ending
module.exports = router;
```

**Warning:** Ensure route files export `router`, not `app` or other objects.
