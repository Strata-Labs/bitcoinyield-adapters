import type { Adapter } from './types.js'

export function defineAdapter(adapter: Adapter): Adapter {
  if (!adapter.slug) throw new Error('Adapter is missing required field: slug')
  if (!adapter.name) throw new Error('Adapter is missing required field: name')
  if (!adapter.url) throw new Error('Adapter is missing required field: url')
  if (typeof adapter.fetch !== 'function') {
    throw new Error('Adapter is missing required field: fetch (must be an async function)')
  }
  return adapter
}
