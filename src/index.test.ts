/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, jest } from '@jest/globals'

const mockRun = jest.fn()

jest.mock('./main', () => ({
  run: mockRun
}))

describe('index.ts', () => {
  it('should call run() on execution', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./index')
    expect(mockRun).toHaveBeenCalled()
  })
})
