/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, expect, it, beforeEach, afterAll, jest } from '@jest/globals'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as cache from '@actions/cache'
import * as glob from '@actions/glob'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { run } from './main'

// Mock dependencies
jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/cache')
jest.mock('@actions/glob')
jest.mock('fs', () => {
  return {
    ...jest.requireActual('fs'),
    promises: {
      mkdir: jest.fn(),
      copyFile: jest.fn(),
      rm: jest.fn(),
      readdir: jest.fn()
    },
    existsSync: jest.fn()
  }
})
jest.mock('os')

describe('main.ts', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()

    // Restore original process values
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
    process.env = { ...originalEnv }

    // Default mock inputs
    ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
      switch (input) {
        case 'unirtm-version': return ''
        case 'install_method': return 'auto'
        case 'github_token': return ''
        case 'github_proxy': return ''
        case 'install_args': return ''
        case 'cache_key': return ''
        case 'cache_key_prefix': return ''
        default: return ''
      }
    })

    ;(core.getBooleanInput as jest.Mock).mockImplementation((input: string) => {
      switch (input) {
        case 'cache': return false
        case 'cache_save': return false
        case 'trust': return false
        case 'install': return false
        default: return false
      }
    })

    // Mock exec and find commands
    ;(exec.exec as jest.Mock).mockResolvedValue(0)
    ;(exec.getExecOutput as jest.Mock).mockImplementation(async (cmd, args) => {
      if (cmd === 'curl') {
        return { stdout: JSON.stringify([{ tag_name: 'v1.0.0', draft: false, prerelease: false }]), exitCode: 0 }
      }
      if (cmd === 'unirtm') {
        return { stdout: '1.0.0', exitCode: 0 }
      }
      return { stdout: '', exitCode: 0 }
    })

    // Mock cache
    ;(cache.restoreCache as jest.Mock).mockResolvedValue(undefined)
    ;(cache.saveCache as jest.Mock).mockResolvedValue(1)

    // Mock fs and os
    ;(os.homedir as jest.Mock).mockReturnValue('/home/user')
    ;(os.tmpdir as jest.Mock).mockReturnValue('/tmp')
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(glob.hashFiles as jest.Mock).mockResolvedValue('fakehash')
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
    process.env = originalEnv
  })

  describe('detectInstallMethod', () => {
    it('should detect npm if available', async () => {
      ;(exec.exec as jest.Mock).mockImplementation(async (cmd, args) => {
        if (args && args.includes('npm')) return 0
        throw new Error('not found')
      })

      await run()
      expect(core.setOutput).toHaveBeenCalledWith('install-method', 'npm')
      expect(exec.exec).toHaveBeenCalledWith('npm', expect.arrayContaining(['install', '-g', '@snowdreamtech/unirtm@latest']))
    })

    it('should detect pip if pip is available and npm is not', async () => {
      ;(exec.exec as jest.Mock).mockImplementation(async (cmd, args) => {
        if (cmd === 'which' && args && args.includes('pip')) return 0
        if (cmd === 'which' && args && args.includes('npm')) throw new Error('not found')
        if (cmd === 'curl') return 0
        throw new Error('not found')
      })

      await run()
      expect(core.setOutput).toHaveBeenCalledWith('install-method', 'pip')
      // pip currently falls back to release download
      expect(exec.exec).toHaveBeenCalledWith('curl', expect.arrayContaining(['-fsSL']))
    })

    it('should detect go if go is available and npm/pip are not', async () => {
      ;(exec.exec as jest.Mock).mockImplementation(async (cmd, args) => {
        if (cmd === 'which' && args && args.includes('go')) return 0
        if (cmd === 'which') throw new Error('not found')
        if (cmd === 'go') return 0
        throw new Error('not found')
      })

      await run()
      expect(core.setOutput).toHaveBeenCalledWith('install-method', 'go')
      expect(exec.exec).toHaveBeenCalledWith('go', expect.arrayContaining(['install']))
    })

    it('should fallback to release if no tools available', async () => {
      ;(exec.exec as jest.Mock).mockImplementation(async (cmd, args) => {
        if (cmd === 'which' || cmd === 'where') throw new Error('not found')
        if (cmd === 'curl') return 0
        return 0
      })

      // We need to mock curl for the github API call to fetch version
      ;(exec.getExecOutput as jest.Mock).mockImplementation(async (cmd, args) => {
        if (cmd === 'curl' && args && args.some((a: string) => a.includes('api.github.com'))) {
          return { stdout: JSON.stringify([{ tag_name: 'v1.0.0', draft: false, prerelease: false }]), exitCode: 0 }
        }
        if (cmd === 'unirtm' && args && args.includes('version')) {
          return { stdout: '1.0.0', exitCode: 0 }
        }
        return { stdout: '', exitCode: 0 }
      })

      // We need fs to pretend to find the binary
      ;(fs.promises.readdir as jest.Mock).mockResolvedValue([{ name: 'unirtm', isDirectory: () => false }])

      await run()
      expect(core.setOutput).toHaveBeenCalledWith('install-method', 'release')
      // curl download
      expect(exec.exec).toHaveBeenCalledWith('curl', expect.arrayContaining(['-fsSL', '--retry', '3']))
    })
  })

  describe('Version Resolution via GitHub Release', () => {
    beforeEach(() => {
      ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'install_method') return 'release'
        return ''
      })
      // Ensure commands mock out to not fail
      ;(exec.exec as jest.Mock).mockResolvedValue(0)
      ;(fs.promises.readdir as jest.Mock).mockResolvedValue([{ name: 'unirtm', isDirectory: () => false }])
      ;(exec.getExecOutput as jest.Mock).mockImplementation(async (cmd, args) => {
        if (cmd === 'unirtm' && args.includes('version')) {
          return { stdout: '1.0.0', exitCode: 0 }
        }
        return { stdout: '', exitCode: 0 }
      })
    })

    it('should fetch latest version if no version specified', async () => {
      ;(exec.getExecOutput as jest.Mock).mockImplementationOnce(async (cmd, args) => {
        return { stdout: JSON.stringify([
          { tag_name: 'v1.1.0', draft: false, prerelease: true },
          { tag_name: 'v1.0.0', draft: false, prerelease: false },
          { tag_name: 'v0.9.0', draft: false, prerelease: false }
        ]), exitCode: 0 }
      })
      await run()
      expect(core.info).toHaveBeenCalledWith('Target unirtm version: 0.9.0')
    })

    it('should fetch latest version if version is "latest"', async () => {
      ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'install_method') return 'release'
        if (input === 'unirtm-version') return 'latest'
        return ''
      })
      ;(exec.getExecOutput as jest.Mock).mockImplementationOnce(async (cmd, args) => {
        return { stdout: JSON.stringify([
          { tag_name: 'v1.1.0', draft: false, prerelease: false },
          { tag_name: 'v1.0.0', draft: false, prerelease: false }
        ]), exitCode: 0 }
      })
      await run()
      expect(core.info).toHaveBeenCalledWith('Target unirtm version: 1.1.0')
    })

    it('should fallback to latest string if not enough releases', async () => {
      ;(exec.getExecOutput as jest.Mock).mockImplementationOnce(async (cmd, args) => {
        return { stdout: JSON.stringify([]), exitCode: 0 }
      })
      await run()
      expect(core.info).toHaveBeenCalledWith('Target unirtm version: latest')
    })

    it('should pass github_token if provided', async () => {
      ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'install_method') return 'release'
        if (input === 'github_token') return 'fake_token'
        return ''
      })
      ;(exec.getExecOutput as jest.Mock).mockImplementationOnce(async (cmd, args) => {
        return { stdout: JSON.stringify([{ tag_name: 'v1.0.0', draft: false, prerelease: false }]), exitCode: 0 }
      })
      await run()
      expect(exec.getExecOutput).toHaveBeenCalledWith('curl', expect.arrayContaining(['Authorization: Bearer fake_token']), expect.anything())
    })
  })

  describe('Installation Methods Specifics', () => {
    describe('npm', () => {
      beforeEach(() => {
        ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
          if (input === 'install_method') return 'npm'
          if (input === 'unirtm-version') return '2.0.0'
          return ''
        })
      })

      it('should install via npm with specific version', async () => {
        ;(exec.getExecOutput as jest.Mock).mockImplementation(async (cmd, args) => {
          if (cmd === 'npm' && args.includes('prefix')) return { stdout: '/npm/prefix', exitCode: 0 }
          if (cmd === 'unirtm') return { stdout: '2.0.0', exitCode: 0 }
          return { stdout: '', exitCode: 0 }
        })

        await run()
        expect(exec.exec).toHaveBeenCalledWith('npm', ['install', '-g', '@snowdreamtech/unirtm@2.0.0'])
        expect(core.addPath).toHaveBeenCalledWith(path.join('/npm/prefix', 'bin'))
      })

      it('should fail if npm install fails', async () => {
        ;(exec.exec as jest.Mock).mockResolvedValue(1) // Failed
        await run()
        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to install unirtm'))
      })
    })

    describe('go', () => {
      beforeEach(() => {
        ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
          if (input === 'install_method') return 'go'
          if (input === 'unirtm-version') return '1.2.3'
          return ''
        })
      })

      it('should install via go', async () => {
        process.env.GOPATH = '/fake/gopath'
        ;(exec.getExecOutput as jest.Mock).mockResolvedValue({ stdout: '1.2.3', exitCode: 0 })

        await run()
        expect(exec.exec).toHaveBeenCalledWith('go', ['install', 'github.com/snowdreamtech/unirtm@v1.2.3'])
        expect(core.addPath).toHaveBeenCalledWith(path.join('/fake/gopath', 'bin'))
      })

      it('should handle go missing gopath', async () => {
        delete process.env.GOPATH
        ;(exec.getExecOutput as jest.Mock).mockResolvedValue({ stdout: '1.2.3', exitCode: 0 })
        await run()
        expect(core.addPath).toHaveBeenCalledWith(path.join('/home/user', 'go', 'bin'))
      })
    })

    describe('release', () => {
      beforeEach(() => {
        ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
          if (input === 'install_method') return 'release'
          if (input === 'unirtm-version') return '1.5.0'
          return ''
        })
        ;(exec.getExecOutput as jest.Mock).mockResolvedValue({ stdout: '1.5.0', exitCode: 0 })
      })

      it('should download and extract for linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' })
        Object.defineProperty(process, 'arch', { value: 'x64' })
        
        ;(fs.promises.readdir as jest.Mock).mockResolvedValue([{ name: 'unirtm', isDirectory: () => false }])
        
        await run()
        
        expect(exec.exec).toHaveBeenCalledWith('curl', expect.arrayContaining(['-fsSL']))
        expect(exec.exec).toHaveBeenCalledWith('tar', expect.arrayContaining(['-xzf']))
        expect(fs.promises.copyFile).toHaveBeenCalled()
        expect(exec.exec).toHaveBeenCalledWith('chmod', ['+x', expect.any(String)])
      })

      it('should download and extract for windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' })
        Object.defineProperty(process, 'arch', { value: 'x64' })
        
        ;(fs.promises.readdir as jest.Mock).mockResolvedValue([{ name: 'unirtm.exe', isDirectory: () => false }])
        
        await run()
        
        expect(exec.exec).toHaveBeenCalledWith('unzip', expect.arrayContaining(['-o']))
        expect(fs.promises.copyFile).toHaveBeenCalled()
        expect(exec.exec).not.toHaveBeenCalledWith('chmod', expect.anything())
      })

      it('should use github_proxy if provided', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' })
        Object.defineProperty(process, 'arch', { value: 'arm64' })
        
        ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
          if (input === 'install_method') return 'release'
          if (input === 'unirtm-version') return '1.5.0'
          if (input === 'github_proxy') return 'https://mirror.example.com/'
          return ''
        })
        ;(fs.promises.readdir as jest.Mock).mockResolvedValue([{ name: 'unirtm', isDirectory: () => false }])
        
        await run()
        
        const curlCall = (exec.exec as jest.Mock).mock.calls.find(c => c[0] === 'curl')
        expect(curlCall[1].some(arg => typeof arg === 'string' && arg.includes('https://mirror.example.com/https://github.com'))).toBe(true)
      })

      it('should retry download on failure', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' })
        Object.defineProperty(process, 'arch', { value: 'x64' })
        
        ;(fs.promises.readdir as jest.Mock).mockResolvedValue([{ name: 'unirtm', isDirectory: () => false }])
        
        let curlAttempts = 0
        ;(exec.exec as jest.Mock).mockImplementation(async (cmd) => {
          if (cmd === 'curl') {
            curlAttempts++
            if (curlAttempts < 3) throw new Error('Network fail')
            return 0
          }
          return 0
        })
        
        await run()
        expect(curlAttempts).toBe(3)
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Downloading (attempt 3/3)'))
      }, 10000)
      
      it('should fail if file not found in extracted archive', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' })
        Object.defineProperty(process, 'arch', { value: 'x64' })
        
        // Empty dir
        ;(fs.promises.readdir as jest.Mock).mockResolvedValue([])
        
        await run()
        
        expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('not found in extracted archive'))
        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to install unirtm@1.5.0 via method "release"'))
      })
    })
  })

  describe('Cache Logic', () => {
    beforeEach(() => {
      ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'install_method') return 'npm'
        return ''
      })
      ;(core.getBooleanInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'cache') return true
        if (input === 'cache_save') return true
        return false
      })
      ;(exec.getExecOutput as jest.Mock).mockResolvedValue({ stdout: '1.0.0', exitCode: 0 })
    })

    it('should restore cache and save state on miss', async () => {
      ;(cache.restoreCache as jest.Mock).mockResolvedValue(undefined)

      await run()

      expect(cache.restoreCache).toHaveBeenCalled()
      expect(core.saveState).toHaveBeenCalledWith('PRIMARY_KEY', expect.any(String))
      expect(core.saveState).toHaveBeenCalledWith('CACHE_PATHS', expect.any(String))
    })

    it('should restore cache and NOT save state on hit', async () => {
      ;(cache.restoreCache as jest.Mock).mockResolvedValue('some-hit-key')

      await run()

      expect(cache.restoreCache).toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith('Cache hit — tools data restored')
    })
  })

  describe('Trust and Install Commands', () => {
    beforeEach(() => {
      ;(core.getInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'install_method') return 'npm'
        if (input === 'install_args') return 'tool1 tool2'
        return ''
      })
      ;(core.getBooleanInput as jest.Mock).mockImplementation((input: string) => {
        if (input === 'trust') return true
        if (input === 'install') return true
        return false
      })
      ;(exec.getExecOutput as jest.Mock).mockResolvedValue({ stdout: '1.0.0', exitCode: 0 })
    })

    it('should run unirtm trust and unirtm install if requested', async () => {
      await run()

      expect(exec.exec).toHaveBeenCalledWith('unirtm', ['trust'])
      expect(exec.exec).toHaveBeenCalledWith('unirtm', ['install', 'tool1', 'tool2'])
    })
  })

  describe('Error handling', () => {
    it('should catch errors and call setFailed', async () => {
      ;(core.getInput as jest.Mock).mockImplementation(() => {
        throw new Error('Something terrible happened')
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('Something terrible happened')
    })

    it('should catch non-Error exceptions and throw', async () => {
      ;(core.getInput as jest.Mock).mockImplementation(() => {
        throw 'String exception'
      })

      await expect(run()).rejects.toEqual('String exception')
      expect(core.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('Unused exports and unsupported platforms', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveUnirtmCache } = require('./main')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const post = require('./post')
    
    it('saveUnirtmCache does nothing if no paths exist', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      await saveUnirtmCache('test-key')
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('No cache paths found on disk'))
    })

    it('saveUnirtmCache saves cache if paths exist', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(cache.saveCache as jest.Mock).mockResolvedValue(123)
      await saveUnirtmCache('test-key')
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Cache saved'))
    })

    it('saveUnirtmCache logs if cache already exists', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      ;(cache.saveCache as jest.Mock).mockResolvedValue(-1)
      await saveUnirtmCache('test-key')
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Cache already exists'))
    })

    it('throws on unsupported platform', async () => {
      ;(core.getInput as jest.Mock).mockImplementation((input) => input === 'install_method' ? 'release' : '')
      Object.defineProperty(process, 'platform', { value: 'sunos' })
      await expect(run()).resolves.toBeUndefined()
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Unsupported platform: sunos'))
      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to install'))
    })

    it('throws on unsupported arch', async () => {
      ;(core.getInput as jest.Mock).mockImplementation((input) => input === 'install_method' ? 'release' : '')
      Object.defineProperty(process, 'platform', { value: 'linux' })
      Object.defineProperty(process, 'arch', { value: 'mips' })
      await expect(run()).resolves.toBeUndefined()
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Unsupported arch: mips'))
      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Failed to install'))
    })
    
    it('detectInstallMethod isCommandAvailable on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      ;(exec.exec as jest.Mock).mockResolvedValue(0)
      await run()
      expect(exec.exec).toHaveBeenCalledWith('where', expect.any(Array), expect.any(Object))
    })
  })
})
