/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, vi as jest } from 'vitest'

const mockRun = jest.fn()

jest.mock('./main', () => ({
  run: mockRun
}))

describe('index.ts', () => {
  it('should call run() on execution', async () => {
    await import('./index.js')
    expect(mockRun).toHaveBeenCalled()
  })
})
