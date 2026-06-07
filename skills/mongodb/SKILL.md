---
id: mongodb
name: MongoDB
description: Read-only MongoDB queries against project-configured databases. Actions: query (find docs), aggregate (pipeline), stats (counts + date range), project_health (pre-built NextPost AI analytics summary). URI and collection hints come from the dashboard Projects → Connectors panel.
---

# MongoDB

Run **read-only** queries against a project's MongoDB database using the URI and collection hints stored in the dashboard **Projects → Connectors** panel.

## When to use

- User asks about project health, analytics, performance, or data ("How is NextPost AI doing?", "Show me recent campaign stats", "What's the engagement trend?")
- A project has a MongoDB connector configured in the dashboard
- You need live data to answer a question rather than reasoning from memory alone

## Connection

The skill reads the `mongodb.uri` and `mongodb.collections` hints from the project's connector entry in `projects.db`. If no project is specified, it uses the project whose name best matches the conversation.

Collection hints are key → collection-name pairs that describe the purpose of each collection. Always prefer using a hint key over guessing a collection name.

## Safety

- **Read-only**: only `find`, `countDocuments`, and `aggregate` are allowed. No writes.
- **Timeout**: 10 s query timeout, 8 s connection timeout.
- **Limit**: `find` results capped at 50 documents; aggregation pipelines limited to 200 output docs.
- **Credentials** are never echoed back in results or error messages.

## Actions

### `mongodb_query` — find documents
Run a `find` against one collection with optional filter, projection, sort, and limit (max 50).

### `mongodb_aggregate` — aggregation pipeline
Run a read-only aggregation pipeline. Use for rollups, grouping, date-range analytics. Limited to 200 output docs.

### `mongodb_stats` — collection stats
Return document count, first/last `createdAt`, and the 3 most recent documents (id + date only) for a named collection. Good for a quick sanity-check before a deeper query.

### `mongodb_project_health` — pre-built NextPost AI health summary
Runs a set of canonical aggregations across the analytics collections (`project-analytics`, `project-pulse`, `campaign-analytics`, `PlatformPost`) and returns a structured health report. Pass `project` name only; collection names come from the stored hints.

## Example use-cases

| Question | Action |
|---|---|
| "How is NextPost AI doing?" | `mongodb_project_health` project=nextpostai |
| "Show campaign analytics for last 30 days" | `mongodb_aggregate` on `campaign-analytics` |
| "How many posts were published this week?" | `mongodb_query` on `PlatformPost` with date filter |
| "What is the project pulse score trend?" | `mongodb_aggregate` on `project-pulse` |

## Tool schema

```tool-schema
mongodb_query
  description: Run a read-only find() against a MongoDB collection. Provide project name (looks up URI + hints), collection (hint key or real name), optional filter (JSON), projection (JSON), sort (JSON), and limit (max 50).
  parameters:
    project: string
    collection: string
    filter: object (optional)
    projection: object (optional)
    sort: object (optional)
    limit: number (optional)

mongodb_aggregate
  description: Run a read-only aggregation pipeline against a MongoDB collection. Provide project name, collection (hint key or real name), and pipeline (array of stage objects). Output capped at 200 docs.
  parameters:
    project: string
    collection: string
    pipeline: array

mongodb_stats
  description: Get document count and date range for a collection. Provide project name and collection (hint key or real name).
  parameters:
    project: string
    collection: string

mongodb_project_health
  description: Pre-built health report for a project — runs canonical aggregations across analytics collections and returns an engagement summary, pulse score trend, and campaign rollup. Pass project name only.
  parameters:
    project: string
```
