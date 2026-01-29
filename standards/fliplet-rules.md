# Fliplet Coding Standards for Code Review

## Critical Rules (Must Not Violate)

### API Usage
- **NEVER use `localStorage`** - Use `Fliplet.Storage` instead
- **NEVER use `fetch()` directly** - Use `Fliplet.API.request()` instead
- **NEVER use `window.location`** - Use `Fliplet.Navigate` instead
- **NEVER modify Fliplet core APIs** - They are read-only
- **NEVER assume Node.js APIs** are available in Fliplet runtime
- Always use `Fliplet.*` namespace for platform features

#### Examples

**Violation:** Using `localStorage`
```js
// BAD
localStorage.setItem('userPref', JSON.stringify(prefs));
const saved = JSON.parse(localStorage.getItem('userPref'));
```
**Fix:** Use `Fliplet.Storage`
```js
// GOOD
Fliplet.Storage.set('userPref', prefs);
Fliplet.Storage.get('userPref').then(function(saved) { /* ... */ });
```

**Violation:** Using `fetch()`
```js
// BAD
fetch('/api/v1/data-sources/123/data').then(res => res.json());
```
**Fix:** Use `Fliplet.API.request()`
```js
// GOOD
Fliplet.API.request({ url: 'v1/data-sources/123/data' });
```

**Violation:** Using `window.location`
```js
// BAD
window.location.href = '/apps/1/screens/2';
```
**Fix:** Use `Fliplet.Navigate`
```js
// GOOD
Fliplet.Navigate.screen(screenId);
```

### Security
- Validate and sanitize all user input before saving or rendering
- Never expose sensitive data (API keys, tokens, passwords) in widget config
- Prevent XSS: sanitize data before DOM insertion
- Prevent SQL injection in data source queries
- Use Fliplet's authentication APIs for auth flows
- Never use `eval()`, `Function()` constructor, or `innerHTML` with unsanitized input

#### Examples

**Violation:** XSS via unsanitized `innerHTML`
```js
// BAD
$('.output').html(userData.name);
element.innerHTML = '<p>' + userInput + '</p>';
```
**Fix:** Use text content or sanitize
```js
// GOOD
$('.output').text(userData.name);
element.textContent = userInput;
```

**Violation:** Hardcoded credentials
```js
// BAD
const API_KEY = 'sk-abc123secret';
Fliplet.API.request({ headers: { 'Authorization': 'Bearer hardcoded-token' } });
```
**Fix:** Use environment config or widget data
```js
// GOOD
const config = Fliplet.Widget.getData(widgetId);
Fliplet.API.request({ headers: { 'Authorization': 'Bearer ' + config.token } });
```

**Violation:** SQL injection in backend
```js
// BAD
const query = `SELECT * FROM users WHERE name = '${req.body.name}'`;
```
**Fix:** Use parameterized queries
```js
// GOOD
const query = 'SELECT * FROM users WHERE name = ?';
db.query(query, [req.body.name]);
```

### Widget Lifecycle
- Use `Fliplet.Widget.instance()` for proper initialization
- Wrap widget code in IIFE to avoid global scope pollution
- Clean up event listeners when widget instances are destroyed
- Widgets may load multiple times on the same page - handle this correctly

#### Examples

**Violation:** Global scope pollution
```js
// BAD
var widgetData = {};
function initWidget() { /* ... */ }
initWidget();
```
**Fix:** IIFE with proper initialization
```js
// GOOD
(function() {
  'use strict';
  var widgetId = Fliplet.Widget.getDefaultId();
  var data = Fliplet.Widget.getData(widgetId) || {};

  Fliplet.Widget.instance(widgetId, function() {
    // Widget initialization here
  });
})();
```

## Warning-Level Rules

### Error Handling
- Handle promise rejections (`.catch()` or try/catch with async/await)
- Show user-friendly errors via `Fliplet.UI.Toast()` for user-facing failures
- Log errors appropriately for debugging

#### Examples

**Violation:** Unhandled promise rejection
```js
// BAD
Fliplet.DataSources.connect(dataSourceId).then(function(connection) {
  return connection.find();
}).then(function(records) {
  renderList(records);
});
```
**Fix:** Add error handling
```js
// GOOD
Fliplet.DataSources.connect(dataSourceId).then(function(connection) {
  return connection.find();
}).then(function(records) {
  renderList(records);
}).catch(function(err) {
  Fliplet.UI.Toast({ message: 'Failed to load data', type: 'error' });
  console.error('DataSource error:', err);
});
```

### Patterns
- Use `Fliplet.Widget.getData()` to retrieve widget configuration
- Use `Fliplet.Widget.save()` for persisting widget settings
- Call `Fliplet.Widget.complete()` after save operations
- Use `Fliplet.Widget.onSaveRequest()` for save validation in interface.js

#### Examples

**Violation:** Missing save validation
```js
// BAD
$('#save-btn').on('click', function() {
  Fliplet.Widget.save(data);
  Fliplet.Widget.complete();
});
```
**Fix:** Use `onSaveRequest` with validation
```js
// GOOD
Fliplet.Widget.onSaveRequest(function() {
  if (!data.title) {
    return Fliplet.UI.Toast({ message: 'Title is required', type: 'error' });
  }
  return Fliplet.Widget.save(data).then(function() {
    Fliplet.Widget.complete();
  });
});
```

### Data Persistence
- Widget configuration: `Fliplet.Widget.save()`
- App data: `Fliplet.DataSources`
- User data: `Fliplet.Storage`
- Temporary data: `Fliplet.Session`

### Performance
- Avoid Fliplet API calls inside loops
- Cache widget data after first load
- Lazy load heavy components
- Minimize DOM manipulation in build.js

#### Examples

**Violation:** API calls in a loop
```js
// BAD
users.forEach(function(user) {
  Fliplet.DataSources.connect(dsId).then(function(conn) {
    conn.insert(user);
  });
});
```
**Fix:** Batch operations
```js
// GOOD
Fliplet.DataSources.connect(dsId).then(function(conn) {
  return conn.import(users);
});
```

### Code Style
- Use strict mode: `'use strict';`
- ES6+ syntax (arrow functions, const/let, destructuring, template literals)
- Wrap in IIFE: `(function() { ... })();`
- No TypeScript - pure JavaScript only
- Vue components use Composition API (NOT Options API)

#### Examples

**Violation:** Vue Options API
```js
// BAD
export default {
  data() { return { count: 0 }; },
  methods: { increment() { this.count++; } }
};
```
**Fix:** Vue Composition API
```js
// GOOD
import { ref } from 'vue';
export default {
  setup() {
    const count = ref(0);
    const increment = () => count.value++;
    return { count, increment };
  }
};
```

## Suggestion-Level Rules

### Best Practices
- Prefer `const` over `let` when variable is not reassigned
- Use descriptive variable and function names
- Keep functions focused and small
- Use early returns to reduce nesting
- Add meaningful comments for complex logic only

### Fliplet-Specific Patterns
- Check API existence before using: `if (Fliplet.Navigator) { ... }`
- Use provider pattern for configurable actions
- Consider offline scenarios for mobile apps
- Test compatibility across Fliplet Studio, web viewer, and mobile

## Backend (fliplet-api) Specific Rules

### Express Routes
- Validate request parameters and body
- Use proper HTTP status codes
- Handle async errors with try/catch or middleware
- Use parameterized queries for database operations (prevent SQL injection)

#### Examples

**Violation:** Missing input validation and error handling
```js
// BAD
router.post('/api/items', function(req, res) {
  db.query('INSERT INTO items (name) VALUES (' + req.body.name + ')');
  res.json({ success: true });
});
```
**Fix:** Validate input, parameterize, handle errors
```js
// GOOD
router.post('/api/items', async function(req, res) {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' });
    }
    await db.query('INSERT INTO items (name) VALUES (?)', [name]);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to create item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Database
- Never concatenate user input into SQL strings
- Use transactions for multi-step operations
- Add appropriate indexes for queried columns
- Handle connection errors gracefully

### Authentication & Authorization
- Verify user permissions before data access
- Use Fliplet's session/token validation
- Never trust client-side auth state alone
- Log security-relevant operations

### API Design
- Follow RESTful conventions
- Return consistent response formats
- Document new endpoints
- Version breaking changes appropriately

## widget.json Configuration Rules

When reviewing `widget.json` files:
- Ensure `name` matches the widget's purpose
- Verify `package` follows naming convention: `com.fliplet.<name>`
- Check that `dependencies` reference valid Fliplet packages
- Ensure `icon` path is valid
- Verify `interface` and `build` HTML file paths are correct
- Check `references` are declared for any provider widgets used
