# Fliplet Studio Specific Rules

These rules apply when reviewing PRs on `fliplet-studio`. They supplement the base `fliplet-rules.md`.

---

## Project Structure

Fliplet Studio is a Vue.js single-page application:

```
fliplet-studio/
├── src/
│   ├── components/        # Vue components (UI/, Signup.vue, Signin.vue, Apps.vue, etc.)
│   ├── router/            # Vue Router configuration
│   ├── store/             # State management
│   ├── libs/              # Utility libraries
│   ├── resources/         # API resources
│   ├── utils/             # Utility functions
│   ├── scss/              # SCSS styles
│   ├── config/            # Frontend configuration
│   ├── main.js            # Application entry point
│   └── Application.vue    # Root Vue component
├── static/                # Static files
├── build/                 # Build configuration
├── config/                # Project configuration
└── test/                  # Test files
```

---

## Vue Component Patterns

### Composition API Required

All new Vue components must use the Composition API. The Options API is deprecated.

**Violation — Options API:**
```js
// BAD
export default {
  data() {
    return { count: 0 };
  },
  methods: {
    increment() {
      this.count++;
    }
  },
  computed: {
    doubled() {
      return this.count * 2;
    }
  }
};
```

**Fix — Composition API:**
```js
// GOOD
import { ref, computed } from 'vue';

export default {
  setup() {
    const count = ref(0);
    const doubled = computed(() => count.value * 2);
    const increment = () => count.value++;
    return { count, doubled, increment };
  }
};
```

**Note:** The Studio codebase contains legacy Options API components. When reviewing PRs that modify these components, existing Options API code being untouched is acceptable. Only flag Options API usage in newly written code or significant rewrites.

---

## Event Bus Pattern

Studio uses an internal event bus for cross-component communication:

```js
// Emitting events
bus.$emit('add-screen', { tracking: false });
bus.$emit('highlight-dropnote');
bus.$emit('page-preview-send-event', {
  type: 'highlightEditables'
});
bus.$emit('show-enforcement-warning', cloneDeep(response.body));

// Listening to events
bus.$on('editing-theme-field', (data) => { /* ... */ });
bus.$on('theme-recompile-started', () => { /* ... */ });
bus.$on('theme-recompile-finished', (response) => { /* ... */ });
```

**Warning:** Event listeners registered with `bus.$on()` must be cleaned up when the component is destroyed to prevent memory leaks.

```js
// GOOD: Clean up in component teardown
beforeDestroy() {
  bus.$off('my-event', this.handler);
}
```

---

## State Management

### Global State Object

Studio uses a shared `state` object for global application state:

```js
// Accessing state
state.page.id
state.userCurrentOrganizationId
state.templates.organization

// State mutations
resetAppState();
setPageLayouts();
toggleIsEditingTheme(data.value);
toggleIsCompilingStyles(true);
```

**Warning:** Never mutate state directly from a component. Use the provided state mutation functions.

---

## API Communication

### HTTP Interceptors

Studio intercepts API responses for billing enforcement and other cross-cutting concerns:

```js
Vue.http.interceptors.push(() => {
  return (response) => {
    const body = response.body || {};

    if (body.type && body.type.indexOf('billing.enforcement') === 0) {
      bus.$emit('show-enforcement-warning', cloneDeep(response.body));
      response.body.handled = true;
    }
  };
});
```

**Warning:** Do not bypass HTTP interceptors by using raw `fetch()` or `XMLHttpRequest`. Always use Vue's built-in HTTP client or `Fliplet.API.request()`.

---

## Router Configuration

Studio uses Vue Router with nested routes:

```js
'/apps/:appId': {
  name: 'app',
  component: App,
  subRoutes: {
    '/edit': {
      name: 'appEdit',
      component: AppEdit,
      subRoutes: {
        '/components': {
          name: 'appEditWidgets',
          component: Widgets,
          appSideView: 'compact'
        }
      }
    }
  }
}
```

**Warning:** When adding new routes:
- Follow the existing nested route structure
- Set `auth: false` only for public routes (login, signup, verify)
- Include `checkDevice: false` and `skipAccountValidate: true` only where appropriate

---

## UI Patterns

### Overlays

Studio uses an overlay system for modal-like panels:

```js
setOverlay('app-setup-wizard', {
  classes: 'app-setup-overlay',
  selectedAppSolution,
  includeHeader: false,
  checkOrgTemplates: true
});
```

### Modals

```js
modal.alert({
  title: 'Appearance compilation error',
  message: 'There\'s an error in the compilation...'
});
```

### Tracking

Studio integrates event tracking:

```js
trackEvent({
  category: 'user_registration',
  action: 'signup_user_exists',
  value: 1
});

trackEvent({
  category: 'component_controls',
  action: 'component_settings',
  label: widgetPackage
});
```

**Suggestion:** New user-facing interactions should include tracking events following the existing pattern.

---

## Widget/Component Integration

### Page Preview Communication

Studio communicates with the page preview iframe via events:

```js
bus.$emit('page-preview-send-event', {
  type: 'highlightEditables'
});

bus.$emit('page-preview-send-event', {
  type: 'reloadCssAsset',
  assets: response.assets
});

bus.$emit('page-preview-send-event', {
  type: 'editHelperWidget',
  id: helperId
});
```

### Widget Instance Management

```js
Fliplet.Studio.emit('reload-widget-instance', widgetId);
```

---

## Security Patterns

### Authentication Flow

Studio handles authentication states:

```js
// Two-factor authentication handling
if (response.status === 428) {
  this.$set('twofactor', response.data.condition);
  // Handle MFA code input
}

// API host redirection for region-specific auth
if (response.data.host) {
  setApiHost(response.data.host);
}
```

**Critical:** Never store authentication tokens in localStorage or expose them in URL parameters.

### Form Validation

```js
hasErrors() {
  this.getErrors();
  return !isEmpty(this.errors);
},
processSignupForm() {
  if (this.hasErrors()) {
    return;
  }
  this.checkUserEmail().then(() => {
    if (this.errors.email) return;
    this.signup();
  });
}
```

**Warning:** All form submissions must validate input before making API calls.

---

## Build & Deployment

### Environment Configuration

```js
// config/index.js — proxy configuration for local development
dev: {
  proxyTable: proxy('https://api.fliplet.test')
  // Change to https://api.fliplet.com or https://staging.api.fliplet.com
}
```

**Critical:** Never commit production API URLs or credentials to config files.

### CI/CD

- CircleCI builds and deploys
- `master` branch deploys to production
- `develop` and `projects/*` branches deploy to staging
- Docker images pushed to ECR, deployed via ECS/Fargate

**Warning:** PRs must target `projects/PS-*` branches, NOT `master`, to ensure staging deployment before production.

---

## Lodash & Utility Usage

Studio uses lodash extensively:

```js
const _ = require('lodash');

// Common patterns
_.pick(req.body, ['name', 'organizationId']);
_.filter(logs, { type: 'app.publish' });
_.get(req.flOrganization, 'organizationUser.organizationRoleId');
_.map(users, 'email');
_.uniq(items, 'field');
```

**Suggestion:** Prefer native JavaScript methods (`.map()`, `.filter()`, `.find()`) over lodash equivalents when the native method is equally clear and performant.

---

## Reactivity Patterns

### Vue 1.x Legacy Patterns

Some Studio code still uses Vue 1.x patterns (migration in progress):

```js
// Vue 1.x pattern — still found in legacy code
this.$set('error', 'Could not authenticate.');
this.$set('twofactor', response.data.condition);
this.$els.mfaCode.focus();
```

**Suggestion:** When refactoring legacy code, migrate `this.$set('key', value)` to Vue 3 reactive patterns (`ref`, `reactive`).

### Clone for Reactivity

```js
// Re-assign for reactive purpose
this.errors = assignIn({}, this.errors, { email: true });
```

**Note:** Deep cloning before assignment is a common pattern to trigger Vue reactivity.
