import { createError } from '@adonisjs/core/exceptions'

export const errors = {
  /**
   * Raised when a running task loses its lock, e.g. it expired or got acquired by another process.
   * The task is aborted with this error as the signal reason.
   */
  E_LOCK_LOST: createError('Task lock was lost while running', 'E_LOCK_LOST'),
}
