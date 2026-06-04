/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as fs from 'fs'
import { post } from './post'

// Mock dependencies
jest.mock('@actions/core')
jest.mock('@actions/cache')
jest.mock('fs')

describe('post.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default mock implementations to avoid unexpected behaviors
    ;(core.getBooleanInput as jest.Mock).mockReturnValue(true)
    ;(core.getState as jest.Mock).mockImplementation((key: string) => {
      if (key === 'PRIMARY_KEY') return 'test-key'
      if (key === 'CACHE_PATHS')
        return JSON.stringify(['/test/path1', '/test/path2'])
      return ''
    })
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(cache.saveCache as jest.Mock).mockResolvedValue(1)
  })

  it('should skip caching if cache input is false', async () => {
    ;(core.getBooleanInput as jest.Mock).mockImplementation((input: string) => {
      if (input === 'cache') return false
      return true
    })

    await post()

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Cache save skipped')
    )
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('should skip caching if cache_save input is false', async () => {
    ;(core.getBooleanInput as jest.Mock).mockImplementation((input: string) => {
      if (input === 'cache_save') return false
      return true
    })

    await post()

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Cache save skipped')
    )
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('should skip caching if PRIMARY_KEY state is missing', async () => {
    ;(core.getState as jest.Mock).mockImplementation((key: string) => {
      if (key === 'PRIMARY_KEY') return ''
      if (key === 'CACHE_PATHS') return JSON.stringify(['/test/path'])
      return ''
    })

    await post()

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('No cache state found')
    )
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('should handle invalid JSON in CACHE_PATHS state', async () => {
    ;(core.getState as jest.Mock).mockImplementation((key: string) => {
      if (key === 'PRIMARY_KEY') return 'test-key'
      if (key === 'CACHE_PATHS') return 'invalid-json'
      return ''
    })

    await post()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse CACHE_PATHS')
    )
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('should skip caching if cache hit occurred', async () => {
    ;(core.getState as jest.Mock).mockImplementation((name: string) => {
      if (name === 'CACHE_RESULT') return 'true'
      if (name === 'CACHE_PATHS') return '["/tmp/cache"]'
      if (name === 'PRIMARY_KEY') return 'test-key'
      return ''
    })
    ;(core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'cache') return 'true'
      if (name === 'cache_save') return 'true'
      return ''
    })

    await post()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('not saving cache')
    )
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('should skip caching if no valid cache paths exist on disk', async () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    await post()

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('No cache paths exist on disk')
    )
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('should save cache successfully if all checks pass', async () => {
    await post()

    expect(fs.existsSync).toHaveBeenCalledTimes(2)
    expect(cache.saveCache).toHaveBeenCalledWith(
      ['/test/path1', '/test/path2'],
      'test-key'
    )
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Cache saved successfully')
    )
  })

  it('should handle cache already existing (saveCache returns -1)', async () => {
    ;(cache.saveCache as jest.Mock).mockResolvedValue(-1)

    await post()

    expect(cache.saveCache).toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Cache already exists')
    )
  })

  it('should not fail the workflow if an error occurs during cache save', async () => {
    const errorMsg = 'Network error'
    ;(cache.saveCache as jest.Mock).mockRejectedValue(new Error(errorMsg))

    // Should not throw
    await expect(post()).resolves.toBeUndefined()
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(`Cache save failed (non-fatal): ${errorMsg}`)
    )
  })
})
