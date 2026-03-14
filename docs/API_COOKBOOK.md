# API Cookbook

## Create A Job

```ts
import { AntigravityTaskdClient, resolveAntigravityTaskdPaths } from '@anthropic/antigravity-taskd'

const workspaceRoot = process.cwd()
const client = new AntigravityTaskdClient(resolveAntigravityTaskdPaths(workspaceRoot).socketPath)
await client.waitForReady()

const created = await client.createJob({
  goal: 'Analyze the workspace and prepare a migration plan',
  mode: 'analysis',
  workspaceRoot,
  fileHints: ['src/index.ts'],
})
```

## Read Latest Snapshot

```ts
const snapshot = await client.getJob(created.jobId)
console.log(snapshot.status)
console.log(snapshot.currentStageId)
console.log(snapshot.workers)
```

## List Jobs

```ts
const listing = await client.listJobs()
console.log(listing.jobs.map(job => [job.jobId, job.status]))
```

## Cancel A Job

```ts
await client.cancelJob(created.jobId)
```

## Stream Events

```ts
const stream = await client.streamJob(created.jobId, (event) => {
  if (event.type === 'snapshot') {
    console.log('snapshot', event.snapshot.status)
    return
  }
  console.log(event.type, event.data)
})

// later
stream.dispose()
```
