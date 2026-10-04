# Recommendation Engine

1. Run `npm install`.
2. Copy `.env.example` to `.env` and add the MongoDB URI from the assignment.
3. Run `npm run discover-db` to list accessible databases, their collections, and two sample documents from each collection.

The URI has no database name. Discovery uses MongoDB's `listDatabases` command, so the account must be allowed to list databases. Sample output redacts common credential and personal-data fields.

The `recommend` function in `src/index.ts` takes normalized posts and user signals. After discovery, map the actual collection fields to those types.

Ranking weights: interest/content 40%, past engagement 30%, follows 15%, popularity 10%, recency 5%.
