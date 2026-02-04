# Fliplet Widget Specific Rules

These rules apply when reviewing PRs on `fliplet-widget-*` repositories. They supplement the base `fliplet-rules.md`.

---

## Widget Structure

Every Fliplet widget follows this standard structure:

```
widget-name/
├── widget.json          # Widget manifest (metadata, dependencies, assets)
├── interface.html       # Configuration UI shown in Fliplet Studio
├── build.html           # Runtime output rendered in apps
├── js/
│   ├── interface.js     # Interface logic (configuration)
│   └── build.js         # Runtime logic (app execution)
├── css/
│   └── build.css        # Widget styling
├── templates/           # Handlebars templates (optional)
│   ├── components/      # Runtime templates
│   └── configurations/  # Builder interface templates
├── img/                 # Widget assets
└── vendor/              # Third-party libs not from Fliplet dependencies
```

**Critical:** Widget code must be organized in this structure. Placing runtime code in `interface.js` or configuration code in `build.js` will cause incorrect behavior.

---

## widget.json Configuration

The manifest defines the widget:

```json
{
  "name": "My Component",
  "package": "com.fliplet.my-component",
  "version": "1.0.0",
  "icon": "img/icon.png",
  "tags": [
    "type:component",
    "category:general"
  ],
  "provider_only": false,
  "references": [],
  "html_tag": "span",
  "interface": {
    "dependencies": [
      "fliplet-core",
      "fliplet-studio-ui"
    ],
    "assets": [
      "js/interface.js"
    ]
  },
  "build": {
    "dependencies": [
      "jquery",
      "bootstrap"
    ],
    "assets": [
      "css/build.css"
    ],
    "appAssets": [
      "css/app.css"
    ]
  }
}
```

**Critical rules for widget.json:**
- `package` must follow naming convention: `com.fliplet.<name>`
- `dependencies` must reference valid Fliplet packages (e.g., `fliplet-core`, `fliplet-studio-ui`, `jquery`, `bootstrap`)
- `interface.assets` and `build.assets` must reference files that exist in the repo
- `icon` path must point to a valid image file
- `references` must declare any provider widgets used by this widget

**Warning:** Adding new dependencies requires verification that the package is available in the Fliplet runtime.

---

## Widget Lifecycle

### IIFE Pattern (Required)

All widget JavaScript must be wrapped in an IIFE to prevent global scope pollution:

```js
// GOOD: Proper IIFE wrapper
(function() {
  'use strict';

  var widgetId = Fliplet.Widget.getDefaultId();
  var data = Fliplet.Widget.getData(widgetId) || {};

  Fliplet.Widget.instance(widgetId, function() {
    // Widget initialization here
  });
})();
```

**Critical violation — global scope pollution:**
```js
// BAD: No IIFE, pollutes global scope
var widgetData = {};
function initWidget() { /* ... */ }
initWidget();
```

### Widget Instance Initialization

The `Fliplet.Widget.instance()` method is the primary entry point for widget runtime code:

```js
// Standard initialization pattern
Fliplet.Widget.instance('my-component', function(data, parent) {
  const $el = $(this); // jQuery reference to widget's DOM element

  // Access saved configuration
  console.log(data.someValue);
}, {
  supportsDynamicContext: false  // Set true for dynamic container support
});
```

**Alternative ID-based initialization:**
```js
Fliplet.Widget.instance(widgetId, function() {
  // Widget initialization
});
```

**Warning:** Widgets may load multiple times on the same page. `Fliplet.Widget.instance()` handles this correctly — do NOT use `document.ready` or other global init patterns.

### Dynamic Context Support

Widgets that can be nested inside dynamic containers (e.g., list entries):

```js
Fliplet.Widget.instance('dynamic-data-component', function(data, parent) {
  // parent.entry contains the dynamic data entry
  console.log(parent.entry);

  // Initialize children components with context
  Fliplet.Widget.initializeChildren(this, parent);
}, {
  supportsDynamicContext: true
});
```

---

## Configuration Interface (interface.js)

### Reading Widget Data

```js
var widgetId = Fliplet.Widget.getDefaultId();
var data = Fliplet.Widget.getData(widgetId) || {};
```

### Save & Complete Pattern

The interface must use `Fliplet.Widget.onSaveRequest()` to handle save:

```js
Fliplet.Widget.onSaveRequest(function() {
  // Validate before saving
  if (!data.title) {
    return Fliplet.UI.Toast({
      message: 'Title is required',
      type: 'error'
    });
  }

  return Fliplet.Widget.save(data).then(function() {
    Fliplet.Widget.complete();
  });
});
```

**Critical violation — saving without validation:**
```js
// BAD: No validation, manual save trigger
$('#save-btn').on('click', function() {
  Fliplet.Widget.save(data);
  Fliplet.Widget.complete();
});
```

**Warning:** Always call `Fliplet.Widget.complete()` after `Fliplet.Widget.save()` resolves. Missing `complete()` leaves the Studio interface in a broken state.

### Reload After Save

Some widgets need to reload the Studio preview after saving:

```js
function save(notifyComplete) {
  Fliplet.Widget.save(widgetData).then(function() {
    if (notifyComplete) {
      Fliplet.Widget.complete();
      window.location.reload();
    } else {
      Fliplet.Studio.emit('reload-widget-instance', widgetId);
    }
  });
}
```

---

## Provider Pattern

Providers are reusable configuration components that widgets can embed:

### Opening a Provider

```js
var provider = Fliplet.Widget.open('com.fliplet.link', {
  selector: '#action-provider',
  data: savedAction,
  onEvent: function(event, data) {
    // Handle provider events
  }
});

// Listen for provider data
provider.then(function(result) {
  // result contains the saved provider data
  savedAction = result.data;
});
```

### Communication Between Widget and Provider

```js
// Widget → Provider: Send data
provider.emit('set-data', { foo: 'bar' });

// Provider: Receive data
Fliplet.Studio.onMessage(function(message) {
  console.log(message.data.event); // 'set-data'
  console.log(message.data.foo);   // 'bar'
});
```

**Warning:** Provider packages used by a widget must be declared in `widget.json` `references` array.

---

## Handlebars Templates

### Build Output

The `build.html` file is compiled with Handlebars using saved widget data:

```handlebars
<div data-widget-id="{{id}}" data-component-name-id="{{id}}">
  <p>{{config.message}}</p>
  <video src="{{url}}"></video>
</div>
```

**Critical:** Always include `data-widget-id="{{id}}"` on the root element for widget targeting.

### Template Files

Separate template files use `.build.hbs` and `.interface.hbs` extensions:

```
templates/
  components/myComponent.build.hbs
  configurations/myConfig.interface.hbs
```

Access compiled templates in JavaScript:

```js
var template = Fliplet.Widget.Templates['components.myComponent'];
var html = template(data);
```

---

## Fliplet API Usage (Widget Context)

### Forbidden Browser APIs

These browser APIs must NOT be used in widgets:

| Forbidden | Fliplet Alternative |
|-----------|-------------------|
| `localStorage` / `sessionStorage` | `Fliplet.Storage` |
| `fetch()` / `XMLHttpRequest` | `Fliplet.API.request()` |
| `window.location` | `Fliplet.Navigate` |
| `eval()` / `Function()` | Never use |
| `document.cookie` | `Fliplet.Session` |

### Data Sources

```js
// Connect and read data
Fliplet.DataSources.connect(dataSourceId).then(function(connection) {
  return connection.find();
}).then(function(records) {
  renderList(records);
}).catch(function(err) {
  Fliplet.UI.Toast({ message: 'Failed to load data', type: 'error' });
  console.error('DataSource error:', err);
});

// Batch operations (NOT individual inserts in a loop)
Fliplet.DataSources.connect(dsId).then(function(conn) {
  return conn.import(users);
});
```

**Critical violation — API calls in a loop:**
```js
// BAD
users.forEach(function(user) {
  Fliplet.DataSources.connect(dsId).then(function(conn) {
    conn.insert(user);
  });
});
```

### Navigation

```js
// Navigate to a screen
Fliplet.Navigate.screen(screenId);

// Navigate to a URL
Fliplet.Navigate.url(url);

// Navigate with options
Fliplet.Navigate.to({ action: 'screen', page: screenId, transition: 'slide.left' });
```

### Storage

```js
// Set a value
Fliplet.Storage.set('key', value);

// Get a value
Fliplet.Storage.get('key').then(function(value) {
  // use value
});
```

### UI Feedback

```js
// Toast notifications
Fliplet.UI.Toast({ message: 'Saved successfully', type: 'success' });
Fliplet.UI.Toast({ message: 'Something went wrong', type: 'error' });

// Modal dialogs
Fliplet.Modal.confirm({ title: 'Are you sure?', message: '...' });
Fliplet.Modal.alert({ title: 'Notice', message: '...' });
```

---

## Error Handling

### Promise Chains

Every promise chain must have a `.catch()` handler:

```js
// GOOD
Fliplet.API.request({ url: 'v1/data' })
  .then(function(response) { /* ... */ })
  .catch(function(err) {
    Fliplet.UI.Toast({ message: 'Request failed', type: 'error' });
    console.error(err);
  });
```

### Fliplet Error Utilities

```js
// Parse Fliplet-specific errors
var message = Fliplet.parseError(err);

// Check if error is already handled
if (Fliplet.Error.isHandled(err)) return;
```

---

## Form Builder Widgets

For widgets in `fliplet-widget-form-builder`:

### Adding Field Types

1. Create Vue component in `js/components/` (runtime)
2. Create Handlebars template in `templates/components/`
3. (Optional) Create configuration component in `js/configurations/`
4. (Optional) Create configuration template in `templates/configurations/`
5. Update `widget.json` asset lists:
   - Shared runtime assets → both `interface.assets` and `build.assets`
   - Builder-only assets → `interface.assets` only

### Asset List Conventions

```json
{
  "interface": {
    "assets": [
      "js/interface.js",
      "js/configurations/myField.js",
      "templates/configurations/myField.interface.hbs"
    ]
  },
  "build": {
    "assets": [
      "js/build.js",
      "js/components/myField.js",
      "templates/components/myField.build.hbs"
    ]
  }
}
```

**Warning:** If a new file is created but not added to `widget.json` assets, it won't be loaded.

---

## Testing

### Environment Check

```js
// Check Fliplet environment
var env = Fliplet.Env.get('platform');  // 'web', 'native'
var mode = Fliplet.Env.get('mode');     // 'interact', 'preview', 'view'
```

### Offline Considerations

Widgets should gracefully handle offline scenarios on mobile:

```js
// Check connectivity before API calls
if (!navigator.onLine) {
  Fliplet.UI.Toast({ message: 'You are offline', type: 'warning' });
  return;
}
```

---

## Style Guidelines

- Pure JavaScript only (NO TypeScript)
- Use `'use strict';` at the top of every IIFE
- ES6+ syntax (arrow functions, const/let, template literals, destructuring)
- jQuery is available via Fliplet dependencies — use `$(this)` inside widget instance
- CSS classes should be namespaced to avoid conflicts (e.g., `.my-widget-container`)
