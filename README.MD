# SuperSave

# Installation

## Sqlite

    npm i --save supersave better-sqlite3

Example connection string: `sqlite://:memory:`

## Mysql

    npm i --save supersave mysql2

Example connection string: `mysql://examplename:somepassword@examplehost:3306/dbname`

# Usage

You can use `addEntity` to create a database-only entity, use `addCollection` to add an entity that will automatically become available via the API.

## Entity

    const planetEntity = {
        name: 'planet',
        template: {
            name: '',
        },
        relations: []
    }

    const moonEntity = {
        name: 'moon',
        template: {
            name: '',
        },
        relations: [{
            name: 'planet',
            field: 'planet',
            multiple: false,
        }],
    }

    const superSave = await SuperSave.create(connectionString);
    await superSave.addEntity(planetEntity);
    await superSave.addEntity(moonEntity);

## Collection

    const planetCollection = {
        name: 'planet',
        template: {
            name: '',
        },
        relations: []
    }

    const moonCollection = {
        name: 'moon',
        template: {
            name: '',
        },
        relations: [{
            name: 'planet',
            field: 'planet',
            multiple: false,
        }],
    }

    const superSave = await SuperSave.create(connectionString);
    await superSave.addCollection(planetCollection);
    await superSave.addCollection(moonCollection);

## Close connection

You can use `await superSave.close()` to close connection with underlying storage. For _sqlite_ this means that connection is closed
and superSave instance can no longer be used. When using _mysql_ this will close all active connections in the pool.

## Querying with Logical Operators

SuperSave provides a fluent API for building complex queries with AND, OR, and NOT logical operators.

### Basic Querying

To query entities programmatically (not via HTTP API), use the `createQuery()` method on a repository:

```typescript
const planetRepository = await superSave.addEntity(planetEntity);
const query = planetRepository.createQuery();

// Simple equality filter
query.eq('name', 'Earth');

// Get results
const planets = await planetRepository.getByQuery(query);
```

### Available Filter Methods

| Method | Description |
| ------- | ----------- |
| `eq(field, value)` | Equals |
| `gt(field, value)` | Greater than |
| `gte(field, value)` | Greater than or equal |
| `lt(field, value)` | Less than |
| `lte(field, value)` | Less than or equal |
| `like(field, value)` | Like (use `*` as wildcard) |
| `in(field, values[])` | In array of values |
| `sort(field, direction)` | Sort by field (`'asc'` or `'desc'`) |
| `limit(n)` | Limit results |
| `offset(n)` | Skip results (pagination) |

### Implicit AND (Default)

When chaining filter methods without specifying a logical operator, they are automatically combined with AND:

```typescript
const query = planetRepository.createQuery();
query.eq('name', 'Earth').eq('distance', 100);
// Generates: WHERE name = 'Earth' AND distance = 100
```

### Explicit AND

Use `and()` to explicitly create an AND group:

```typescript
const query = planetRepository.createQuery();
query.and().eq('name', 'Earth').eq('distance', 100);
// Generates: WHERE (name = 'Earth' AND distance = 100)
```

### OR

Use `or()` to create an OR group:

```typescript
const query = planetRepository.createQuery();
query.or().eq('name', 'Earth').eq('name', 'Mars');
// Generates: WHERE (name = 'Earth' OR name = 'Mars')
```

### NOT

Use `not()` to negate a filter:

```typescript
const query = planetRepository.createQuery();
query.not().eq('name', 'Pluto');
// Generates: WHERE NOT (name = 'Pluto')
```

### Nested Groups

Pass sub-queries to `or()` or `and()` to create nested conditions:

```typescript
const query = planetRepository.createQuery();

// OR of two AND groups
query.or(
  planetRepository.createQuery().and().eq('name', 'Earth').eq('distance', 100),
  planetRepository.createQuery().and().eq('name', 'Venus').eq('distance', 200)
);
// Generates: WHERE ((name = 'Earth' AND distance = 100) OR (name = 'Venus' AND distance = 200))
```

### Complex Queries

Combine multiple logical operators for complex conditions:

```typescript
const query = planetRepository.createQuery();

// Find visible planets that are either Earth or Mars
query.and().eq('visible', true).or(
  planetRepository.createQuery().eq('name', 'Earth'),
  planetRepository.createQuery().eq('name', 'Mars')
);

const planets = await planetRepository.getByQuery(query);
```

### Sorting and Limiting

```typescript
const query = planetRepository.createQuery();
query
  .or().eq('name', 'Earth').eq('name', 'Mars')
  .sort('name', 'desc')  // Sort by name descending
  .limit(10)             // Maximum 10 results
  .offset(5);            // Skip first 5 results

const planets = await planetRepository.getByQuery(query);
```

### Getting a Single Result

```typescript
const query = planetRepository.createQuery();
query.eq('name', 'Earth');

const planet = await planetRepository.getOneByQuery(query);
```

**Note:** To use filters, the field must be defined in `filterSortFields` when creating the entity or collection.

# HTTP API Configuration

SuperSave provides a generic HTTP interface that works with multiple server frameworks. The API uses the [better-call](https://github.com/bekacru/better-call) library under the hood, providing framework-agnostic routing.

## Framework Integration

### Express

```typescript
import express from "express";
import { SuperSave } from "supersave";

const app = express();
const superSave = await SuperSave.create("sqlite://:memory:");

await superSave.addCollection(planetCollection);

// Mount the API at the root
app.use("/", superSave.getNodeHandler());

// Or mount at a specific path
app.use("/api", superSave.getNodeHandler());

app.listen(3000);
```

### Node HTTP Server

```typescript
import http from "node:http";
import { SuperSave } from "supersave";

const superSave = await SuperSave.create("sqlite://:memory:");
await superSave.addCollection(planetCollection);

const server = http.createServer(superSave.getNodeHandler());
server.listen(3000);
```

### Next.js App Router

```typescript
// app/api/[...path]/route.ts
import { SuperSave } from "supersave";

const superSave = await SuperSave.create("sqlite://./data.db");
await superSave.addCollection(planetCollection);

const handler = superSave.getHandler();

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}

export async function PATCH(request: Request) {
  return handler(request);
}

export async function DELETE(request: Request) {
  return handler(request);
}
```

## Handler Methods

SuperSave provides two handler methods for different use cases:

| Method             | Description                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `getHandler()`     | Returns a Web Standard Request/Response handler. Works with Next.js, Bun, Deno, and any environment supporting the Fetch API. |
| `getNodeHandler()` | Returns a Node.js http compatible handler. Works with Node's `http.createServer()` and Express.                               |

# HTTP API Endpoints

Once configured, SuperSave exposes the following REST endpoints for each collection:

| Endpoint            | Method | Description                                                     |
| ------------------- | ------ | --------------------------------------------------------------- |
| `/{collection}`     | GET    | List all items with optional filtering, sorting, and pagination |
| `/{collection}`     | POST   | Create a new item                                               |
| `/{collection}/:id` | GET    | Get a single item by ID                                         |
| `/{collection}/:id` | PATCH  | Update an item by ID                                            |
| `/{collection}/:id` | DELETE | Delete an item by ID                                            |
| `/`                 | GET    | List all registered collections                                 |

Collection names are automatically pluralized (e.g., `planet` becomes `planets`).

## Query Parameters for GET Requests

| Parameter     | Description                                                             | Example                            |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `sort`        | Sort by field(s). Prefix with `-` for descending order.                 | `?sort=name` or `?sort=-createdAt` |
| `limit`       | Maximum number of items to return (default: 25). Use `-1` for no limit. | `?limit=10`                        |
| `offset`      | Number of items to skip for pagination.                                 | `?offset=20`                       |
| `{field}`     | Filter by exact field value.                                            | `?name=Earth`                      |
| `{field}[>]`  | Greater than filter.                                                    | `?distance[>]=1000`                |
| `{field}[>=]` | Greater than or equal filter.                                           | `?distance[>=]=1000`               |
| `{field}[<]`  | Less than filter.                                                       | `?distance[<]=5000`                |
| `{field}[<=]` | Less than or equal filter.                                              | `?distance[<=]=5000`               |
| `{field}[~]`  | Like filter (use `*` as wildcard).                                      | `?name[~]=*art*`                   |
| `{field}[in]` | In filter (comma-separated values).                                     | `?name[in]=Earth,Mars`             |

**Note:** To use filters, the field must be defined in `filterSortFields` when creating the collection.

## Response Format

### Success Response

```json
{
  "data": { ... },
  "meta": {
    "sort": [...],
    "limit": 25,
    "offset": 0,
    "filters": [...]
  }
}
```

### Error Response

```json
{
  "code": "ERROR_CODE",
  "message": "Error description"
}
```

## Example Requests

```bash
# List all planets
curl http://localhost:3000/planets

# Get a specific planet
curl http://localhost:3000/planets/abc123

# Create a new planet
curl -X POST http://localhost:3000/planets \
  -H "Content-Type: application/json" \
  -d '{"name": "Mars"}'

# Update a planet
curl -X PATCH http://localhost:3000/planets/abc123 \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Mars"}'

# Delete a planet
curl -X DELETE http://localhost:3000/planets/abc123

# Filter and sort
curl "http://localhost:3000/planets?sort=-name&limit=10&distance[>]=100"
```

# Migrations

SuperSave includes a migration system that allows you to run custom code when the application starts. This is useful for seeding data, updating existing records, or performing any other initialization tasks.

## Registration

You can register migrations when creating a `SuperSave` instance by providing them in the `SuperSaveOptions`.

```typescript
import { SuperSave, Migration } from "supersave";

const migrations: Migration[] = [
  {
    name: 'seed-planets',
    run: async (ss) => {
      const planetRepo = ss.getRepository('planet');
      await planetRepo.create({ name: 'Earth' });
      await planetRepo.create({ name: 'Mars' });
    }
  },
  {
    name: 'mysql-specific-init',
    engine: 'mysql',
    run: async (ss) => {
      // This will only run when using a MySQL connection
      // Use getConnection() for raw SQL queries
      const pool = ss.getConnection<Pool>();
      await pool.query('CREATE INDEX idx_custom ON some_table(some_column)');
    }
  }
];

const superSave = await SuperSave.create(connectionString, { migrations });
```

## Options

The `SuperSave.create` method accepts a `SuperSaveOptions` object as the second argument:

| Option | Type | Description |
| --- | --- | --- |
| `migrations` | `Migration[]` | An array of migration objects to be executed. |
| `skipSync` | `boolean` | If `true`, the automatic schema synchronization for entities will be skipped. |

## Execution and Tracking

- Migrations are tracked in a `_supersave_migrations` table in your database.
- Each migration is executed only once.
- Migrations are executed in the order they are provided in the `migrations` array.
- If a migration has an `engine` specified ('mysql' or 'sqlite'), it will only run if the current database connection matches that engine.
- The `run` function receives the `SuperSave` instance, allowing you to use repositories or perform raw queries via `getConnection()`.

You are yourself responsible for invoking runMigrations() after creating the SuperSave instance. This is because only you can make
sure that the required entities are created and available before running the migrations.

# Hooks

There are several hooks available that can be used to manipulate the behavior in the HTTP endpoints:

```typescript
import { HttpContext, Collection } from "supersave";

export type Hooks = {
  get?: (collection: Collection, ctx: HttpContext) => Promise<void> | void;
  getById?: <T>(
    collection: Collection,
    ctx: HttpContext,
    entity: T | null
  ) => Promise<T> | T;
  entityTransform?: <IN, OUT>(
    collection: Collection,
    ctx: HttpContext,
    entity: IN
  ) => Promise<OUT> | OUT;
  updateBefore?: <IN, OUT>(
    collection: Collection,
    ctx: HttpContext,
    entity: Partial<IN>
  ) => Promise<OUT> | OUT;
  createBefore?: <IN, OUT>(
    collection: Collection,
    ctx: HttpContext,
    entity: Omit<IN, "id">
  ) => Promise<OUT> | OUT;
  deleteBefore?: <T>(
    collection: Collection,
    ctx: HttpContext,
    item: Omit<T, "id"> | null
  ) => Promise<void> | void;
};
```

The `HttpContext` provides access to request data:

```typescript
type HttpContext = {
  params: Record<string, string>; // URL parameters (e.g., :id)
  query: Record<string, string>; // Query string parameters
  body: unknown; // Request body
  headers: Record<string, string>; // Request headers
  request?: Request; // Raw Web Standard Request object
};
```

A hook can be set when registering a collection, by providing at least one of the functions described above.

```typescript
const planetCollection = {
  name: "planet",
  template: {
    name: "",
  },
  relations: [],
  hooks: [
    {
      createBefore: (collection, ctx, entity) => {
        return { ...entity, createdAt: new Date() };
      },
      entityTransform: (collection, ctx, entity) => {
        const { internalField, ...rest } = entity;
        return rest;
      },
    },
  ],
};
```

| Hook            | Description                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| get             | Manipulate the filters/get parameters of the request before data is actually being requested. The endpoint is `/planet` for example.                                                                                                                   |
| getById         | Perform an action on the retrieved entity before it is transformed and then returned via the API. Entity value can be `null` if its not found.                                                                                                         |
| entityTransform | Used at every location where an entity is returned in the API (create, update, get, getById). The entity as its retrieved from the database can be changed. For example a field that should not be publicly displayed can be removed from the payload. |
| updateBefore    | This hook is invoked just before the updated statement is executed towards the database. The `entity` argument in the payload is the entire object, not just the provided fields in the request.                                                       |
| createBefore    | Invoked before an item is created, the function will receive the item as it will be saved. The `id` field will not be available, unless explicitly specified in the API request.                                                                       |
| deleteBefore    | Invoked before an item is deleted.                                                                                                                                                                                                                     |

## Errors

Any error that is thrown from within a hook is output directly towards the requester in the API. So be careful that no unwanted information
is leaked via the Error. A `HookError` can be imported `import { HookError } from 'supersave';`. An exception with
a defined HTTP status code can be initialized via is contructor: `throw new HookError('msg', 401)`. This will result in a HTTP 401 error
in the API output, with the JSON payload containing the message.

## Access the native connection

The `SuperSave` class offers a function `getConnection()` that returns the underlying connection. This can be used to perform
custom queries.

| Connection | Description                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| sqlite     | The sqlite connection is a [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) `Database` object. |
| mysql      | The mysql connection is a [mysql2](https://www.npmjs.com/package/mysql2) `Pool` object.                      |

In typescript, the `getConnection<T>()` provides a generic type, which you can use to set the
expected return type from the function. You are yourself responsible for the correct type.

### Example: Running raw SQL queries

```typescript
// MySQL
import type { Pool } from 'mysql2/promise';
const pool = superSave.getConnection<Pool>();
const [rows] = await pool.query('SELECT * FROM my_table WHERE id = ?', [id]);

// SQLite
import type { Database } from 'better-sqlite3';
const db = superSave.getConnection<Database>();
const rows = db.prepare('SELECT * FROM my_table WHERE id = ?').all(id);
```

# Development

This module currently supports both sqlite and mysql. Development for sqlite is pretty straight-forward,
you can use `:memory:` as the filename to set up a memory-only database.

Mysql is a bit more cumbersome, as it requires a running mysql server. For this purpose a `docker-compose.yml` file is present in the repository. Run
the following command to start a jest watch command for the unit tests.

    docker-compose up

This command uses the `--runInBand` to run all tests synchronously, to prevent the tests from interfering with each other. Each test will drop all tables
in the database before running, so that they do not interfere with each other.

# Releasing

This package is automatically published to npm when a new GitHub release is published. The version is determined by the release tag.

## Stable Release

To create a new stable release:

1. Go to the [Releases page](../../releases) on GitHub
2. Click "Create a new release"
3. Create a new tag with a version number following semantic versioning (e.g., `v1.2.3`)
4. Fill in the release title and description
5. Click "Publish release"

The workflow will automatically update `package.json` on the main branch to match the released version.

## Beta Release

To create a new beta release:

1. Go to the [Releases page](../../releases) on GitHub
2. Click "Create a new release"
3. Create a new tag with a pre-release identifier (e.g., `v1.2.3-beta.1`)
4. Check "Set as a pre-release"
5. Click "Publish release"

Beta releases are published to npm with the `beta` tag and do not update `package.json` on main.
