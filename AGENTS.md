# AGENTS.md

This file contains guidelines for agentic coding agents working in this repository.

## Build, Lint, and Test Commands

- `pnpm build` - Build TypeScript to `dist/` directory
- `pnpm lint` - Run all linting checks (TypeScript + Biome)
- `pnpm lint:tsc` - Type checking only
- `pnpm lint:biome` - Biome linting only
- `pnpm format` - Format code with Biome
- `pnpm test` - Run all tests (SQLite only)
- `pnpm test:all` - Run SQLite, MySQL, and MariaDB tests
- `pnpm test:mysql` - Run tests with MySQL connection
- `pnpm test:mariadb` - Run tests with MariaDB connection
- `pnpm test:watch` - Watch mode for testing
- `pnpm test:ui` - Run Vitest UI

**Running a single test file:**
```bash
pnpm vitest run path/to/test-file.test.ts
```

## Code Style Guidelines

### File Naming
- Use `kebab-case` for all TypeScript files (enforced by Biome)
- Example: `entity-manager.ts`, `http-actions.ts`

### Imports
- All imports must include `.js` extension (ES modules requirement)
- Use `import type` for type-only imports (Biome enforced)
- Group imports: type imports first, then value imports, then local modules
```typescript
import type { Debugger } from 'debug';
import Debug from 'debug';
import { Query } from '../types.js';
```

### Formatting
- 2 spaces for indentation
- 80 character line width
- Single quotes for strings
- Semicolons always required
- Trailing commas in ES5 style
- Single statements on one line, braces on same line

### TypeScript
- Strict mode enabled (tsconfig.json)
- Explicit type annotations for function parameters and returns
- Use generics sparingly and purposefully
- Prefer interfaces for public APIs, types for unions/maps
- Use `as` casting only when necessary (e.g., database results)
- Use `@ts-expect-error` comments for intentional type suppressions

### Naming Conventions
- Classes: `PascalCase` - `class SuperSave {}`
- Interfaces: `PascalCase` - `interface BaseEntity {}`
- Types: `PascalCase` - `type QueryFilter = {}`
- Functions/Variables: `camelCase` - `getById()`, `const tableName`
- Constants: `SCREAMING_SNAKE_CASE` or `camelCase` (commonly camelCase for debug)
- Private members: `private` keyword, prefixed with underscore optional but consistent
- Enum values: `PascalCase` - `QueryOperatorEnum.EQUALS`

### Error Handling
- Use `throw new Error()` for general errors
- Use `HookError` from `./collection/error/index.js` for HTTP hook errors with status codes
- Always include descriptive error messages
- Catch and log errors with debug module: `debug('Error message', error)`
- HTTP errors: use `ctx.error('STATUS_CODE', { message })` in collection actions

### Comments
- Use JSDoc for public methods and exported interfaces
- Keep comments concise and focused on "why" not "what"
- Use `@example` for usage documentation
- No inline comments for obvious code

### Database Patterns
- Always use parameterized queries to prevent SQL injection
- Use `pool.escapeId()` for table/column names in MySQL
- Use prepared statements for SQLite
- Handle both MySQL JSON columns (objects) and string JSON (parse both)
- Filter/sort fields must be defined in `filterSortFields` entity property

### Testing
- Use Vitest with `test`, `expect`, `beforeEach` from `vitest`
- Clean up database state in `beforeEach` or use `clear()` helper
- Arrange tests in logical order (unit first, then integration)
- Test file naming: `*.test.ts`
- Use descriptive test names: `test('should create entity', ...)`

### Code Organization
- Use `index.ts` files for barrel exports in directories
- Keep each file focused on a single responsibility
- Abstract classes for base implementations, concrete classes for DB-specific
- Separate database logic (sqlite/, mysql/) from generic entity management

### Hooks and HTTP
- Collection hooks: `createBefore`, `updateBefore`, `entityTransform`, `get`, `getById`, `deleteBefore`
- HttpContext includes: `params`, `query`, `body`, `headers`, `request`
- Transform functions receive collection, context, and entity/data
- Hook errors propagate to API responses directly (be careful with sensitive data)
