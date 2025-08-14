<div align="center">
  <h2><b>Adonis Scheduler</b></h2>
  
  <p>

`@outloud/adonis-scheduler` is a cron job scheduler for [AdonisJS](https://adonisjs.com/).

  </p>
</div>


<div align="center">

[![npm-image]][npm-url] [![license-image]][license-url]

</div>

---
## Features
- Define tasks with cron-like scheduling.
- Run tasks as standalone processes or as part of the HTTP server.
- Locking mechanism to prevent concurrent task execution.
- Cancellation support for long-running tasks.
- Graceful shutdown.
- Global and task-level error handling.

## Getting Started

Install the package from the npm registry and configure it.

```bash
node ace add @outloud/adonis-scheduler
```

See `config/scheduler.ts` for available configuration options.

## Usage

To make scheduler work, you must define and register tasks.

### Define a task

You can create a task using `node ace make:task <task-name>` command. This will create a new task file in the `app/tasks` directory.

```ts
import { Task, type TaskOptions } from '@outloud/adonis-scheduler'

export default class TestTask extends Task {
  static options: TaskOptions = {
    schedule: '* * * * *'
  }

  async run(): Promise<void> {
    // Your task logic here
  }
}
```

### Register a task

For task to run it must be registered in the scheduler. You can register tasks in two ways: using the `start/scheduler.ts` preloaded file or in a provider's `start` method.

Using `start/scheduler.ts` file.

```ts
import scheduler from '@outloud/adonis-scheduler/services/main'

scheduler.register(() => import('../app/tasks/test.task.js'))
```

Or using a provider.

```ts
import type { ApplicationService } from '@adonisjs/core/types'
import scheduler from '@outloud/adonis-scheduler/services/main'

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  start() {
    scheduler.register(() => import('../app/tasks/test.task.js'))
  }
}

```

You can also run other commands using scheduler without defining custom Task class.

```ts
import scheduler from '@outloud/adonis-scheduler/services/main'

scheduler.register({
  command: '<command-name>',
  schedule: '* * * * *',
})
```

### Running the scheduler

The scheduler can be run as standalone process or as part of the HTTP server.

To run it as a **standalone process**, you can use the following command:

```bash
node ace scheduler:run
```

To run it as part of the **HTTP server**, set following env variable:

```bash
SCHEDULER_HTTP_SERVER=true
```

## Locking

> [!NOTE]
> This requires [@adonisjs/lock](https://docs.adonisjs.com/guides/digging-deeper/locks) package to be installed and configured.

The scheduler supports locking to prevent multiple instances of the same task from running concurrently. You can enable locking by setting the `lock` option in the task options.

```ts
import { Task, type TaskOptions } from '@outloud/adonis-scheduler'

export default class TestTask extends Task {
  static options: TaskOptions = {
    schedule: '* * * * *',
    lock: true // or value for lock ttl
  }

  async run(): Promise<void> {
    // Your task logic here
  }
}
```

## Cancellation

The package supports cancellation and graceful shutdown. You can add `onCancel` handler in your task or watch for `isCanceled` property.

```ts
import { Task } from '@outloud/adonis-scheduler'

export default class TestTask extends Task {
  async run(): Promise<void> {
    while (!this.isCanceled) {
      // Your task logic here
    }
  }

  async onCancel(): Promise<void> {
    // teardown running logic
  }
}
```

## Error handling

It's possible to globally handle errors for all your tasks or define custom error handler for each task.

To register global error handler, you can use the `onError` method of the scheduler service. You can define it in `start/scheduler.ts` preloaded file.
This handler will run only if custom error handler is not defined in the task itself.

```ts
import logger from '@adonisjs/core/services/logger'
import scheduler from '@outloud/adonis-scheduler/services/main'
import { Sentry } from '@rlanz/sentry'

scheduler.onError((error, task) => {
  logger.error(error)
  Sentry.captureException(error)
})
```

Custom error handler can be defined in the task itself by implementing `onError` method.

```ts
import { Task } from '@outloud/adonis-scheduler'

export default class TestTask extends Task {
  async onError(error: Error): Promise<void> {
    // handle error
  }
}
```

[npm-image]: https://img.shields.io/npm/v/@outloud/adonis-scheduler.svg?style=for-the-badge&logo=**npm**
[npm-url]: https://npmjs.org/package/@outloud/adonis-scheduler "npm"

[license-image]: https://img.shields.io/npm/l/@outloud/adonis-scheduler?color=blueviolet&style=for-the-badge
[license-url]: LICENSE "license"
