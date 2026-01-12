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

You can use `await superSave.close()` to close the connection with the underlying storage. For _sqlite_ this means that the connection is closed
and the superSave instance can no longer be used. When using _mysql_ this will close all active connections in the pool.

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

The `SuperSave` class offers a function `getConnection()`that returns the underlying connection. This can be used to perform
custom queries.

| Connection | Description                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| sqlite     | The sqlite connection is a [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) `Database` object. |
| mysql      | The mysql connection is a [mysql2](https://www.npmjs.com/package/mysql2) `Pool` object.                      |

In typescript, the `getConnection<T>()` provides a generic type, which you can use to set the
expected return type from the function. You are yourself responsible for the correct type.

# Development

This module currently supports both sqlite and mysql. Development for sqlite is pretty straight-forward,
you can use `:memory:` as the filename to set up a memory-only database.

Mysql is a bit more cumbersome, as it requires a running mysql server. For this purpose a `docker-compose.yml` file is present in the repository. Run
the following command to start a jest watch command for the unit tests.

    docker-compose up

This command uses the `--runInBand` to run all tests synchronously, to prevent the tests from interfering with each other. Each test will drop all tables
in the database before running, so that they do not interfere with each other.

# Releasing

This package is automatically published to npm when a new git tag is pushed.

## Stable Release

To create a new stable release, create a new git tag with a version number that follows semantic versioning and push it to the repository.

```bash
git tag v1.2.3
git push origin v1.2.3
```

## Beta Release

To create a new beta release, create a new git tag with a version number that includes a pre-release identifier and push it to the repository.

```bash
git tag v1.2.3-beta.1
git push origin v1.2.3-beta.1
```
