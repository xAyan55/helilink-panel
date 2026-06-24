# Modrinth Store — Architecture

## Overview

The Modrinth Store is a panel addon that integrates the [Modrinth](https://modrinth.com) API into HeliLink, allowing users to browse, search, and install mods, modpacks, plugins, shaders, resource packs, and datapacks directly from the panel UI.

## Directory Structure

```
storage/addons/modrinth/
├── package.json              # Addon manifest (routes, migrations, settings schema)
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point — wires all components
│   ├── types/
│   │   ├── modrinth-api.ts   # Modrinth API types with Zod schemas
│   │   ├── types.ts          # Legacy types (kept for compatibility)
│   │   ├── express.d.ts      # Express type augmentations
│   │   ├── global.d.ts       # Global type augmentations
│   │   └── index.ts          # Re-exports
│   ├── lib/                  # Core business logic
│   │   ├── modrinth-client.ts    # HTTP client for Modrinth API v2 with Zod validation
│   │   ├── cache-store.ts        # Two-tier cache (memory + SQLite)
│   │   ├── daemon-client.ts      # Panel daemon RPC client
│   │   ├── installer.ts          # Mod/modpack installation engine
│   │   ├── dependency-resolver.ts # Resolves required dependencies
│   │   ├── progress-tracker.ts   # Real-time installation progress
│   │   ├── settings-store.ts     # Typed config management
│   │   └── update-checker.ts     # Checks for mod updates
│   ├── routes/               # Express route handlers
│   │   ├── index.ts          # Router aggregation with auth+CSRF
│   │   ├── pages/            # Page routes (render EJS views)
│   │   │   ├── browse.ts
│   │   │   ├── project.ts
│   │   │   └── admin.ts
│   │   └── api/              # JSON API routes
│   │       ├── search.ts, project.ts, install.ts
│   │       ├── servers.ts, config.ts
│   │       ├── progress.ts, health.ts, cache.ts
│   │       ├── statistics.ts, installations.ts
│   │       └── (collections.ts, search-history.ts — planned)
│   ├── ui/                   # UI registration
│   │   ├── sidebar.ts        # Sidebar item registration
│   │   └── lifecycle.ts      # Addon lifecycle hooks
│   └── utils/                # Shared utilities
│       ├── auth.ts           # Authentication helpers
│       ├── validation.ts     # Input validation/sanitization
│       └── escape.ts         # HTML/JS escaping
├── views/
│   ├── desktop/              # Desktop EJS templates
│   │   ├── browse.ejs
│   │   ├── project.ejs
│   │   ├── admin-config.ejs
│   │   └── components/       # Extracted reusable components
│   │       ├── warning-banner.ejs
│   │       ├── project-card.ejs
│   │       └── version-list.ejs
│   └── mobile/               # Mobile EJS templates
│       ├── browse.ejs
│       ├── project.ejs
│       ├── admin-config.ejs
│       └── components/
│           └── warning-banner.ejs
└── modrinth-settings.json    # Runtime settings (warnings, blocked projects)
```

## Data Flow

```
User Action → Browser → Express Router
  │
  ├─ Auth Middleware (session check)
  ├─ CSRF Middleware (POST/DELETE only)
  │
  ├─ Page Route → resolveUser → renderView → EJS template → HTML response
  │
  └─ API Route → resolveUser → validate input →
      ├─ ModrinthClient (search, project, version) → Cache → Response
      ├─ DaemonClient (upload, delete, list) → Response
      ├─ Installer (download → verify → upload) → ProgressTracker → Response
      └─ SettingsStore (get/set settings) → Response
```

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `ModrinthClient` | HTTP client for api.modrinth.com/v2. Handles retry (5xx only), rate limiting (429), timeouts, URL validation, Zod schema validation. |
| `TwoTierCacheStore` | Two-tier cache: in-memory Map (fast) + SQLite (persistent). 5-minute memory TTL, 10-minute SQLite TTL. Background cleanup. |
| `DaemonClient` | HTTP client for the panel's per-node daemon. File upload/download/delete, server status. Path sanitization enforced on all file operations. |
| `Installer` | Orchestrates mod/modpack installation. Downloads files, verifies hashes, uploads via daemon, tracks progress. Handles .mrpack parsing for modpacks. |
| `DependencyResolver` | Resolves required dependencies from version data. Finds compatible versions by matching game versions and loaders. |
| `UpdateChecker` | Compares installed version IDs against latest versions from Modrinth API. |
| `ProgressTracker` | In-memory singleton tracking active installations. Provides real-time progress updates for polling. |
| `SettingsStore` | Typed wrapper around the panel's addon config API. In-memory cache with 30s TTL. |

## Security Model

1. **Auth on all routes** — Every route requires session authentication via `auth.createAuthMiddleware()`.
2. **CSRF on mutations** — All POST/DELETE/PUT routes use panel's CSRF protection.
3. **Path sanitization** — All file paths pass through `DaemonClient.sanitizeFilePath()` to prevent directory traversal.
4. **URL validation** — All external URLs validated against allowed domains (api.modrinth.com, cdn.modrinth.com).
5. **Input validation** — All user input validated via `utils/validation.ts` before use.
6. **Zod validation** — All Modrinth API responses validated against Zod schemas before use.
7. **No raw SQL with string interpolation** — Database operations use parameterized queries via `$executeRaw` tagged templates.

## Database Tables

| Table | Purpose |
|-------|---------|
| `ModrinthCache` | API response cache (cacheKey, data, expiresAt) |
| `ModrinthInstallation` | Installation records (projectId, versionId, serverId, status, error) |
| `ModrinthCollection` | User-created mod collections |
| `ModrinthCollectionItem` | Items within collections |
| `ModrinthSearchHistory` | User search history |

Created via addon migrations declared in `package.json`.

## Addon API Contract

The addon receives an `AddonApi` object from the panel providing:

- **`prisma`** — Typed Prisma client for DB operations
- **`security`** — Path sanitization, URL validation, auth/CSRF middleware factories
- **`config`** — Per-addon key-value config store
- **`ui`** — Sidebar item registration
- **`getComponent(name, viewport)`** — Resolve panel UI component paths by name
- **`getComponents(viewport)`** — Get all panel UI component paths
- **`renderView`** — EJS view rendering with panel layout wrapper
- **`logger`** — Structured logging
- **`schedule`** — Background task registration
- **`assetsUrl`** — URL prefix for addon static assets
