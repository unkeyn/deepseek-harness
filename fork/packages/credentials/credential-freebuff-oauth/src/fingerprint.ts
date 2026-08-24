/** Freebuff-compatible CLI fingerprint generation. */

import { createHash, randomBytes } from 'node:crypto'
import { cpus, networkInterfaces } from 'node:os'
import { execFileSync } from 'node:child_process'

type MachineIdModule = typeof import('node-machine-id')
type SystemInformationModule = typeof import('systeminformation')
type ShellName = 'bash' | 'zsh' | 'fish' | 'cmd.exe' | 'powershell' | string

let machineIdModule: MachineIdModule | undefined
let systemInformationModule: SystemInformationModule | undefined
let cachedFingerprintPromise: Promise<string> | undefined
let cachedShell: ShellName | undefined

const SHELL_ALIASES: Record<string, ShellName> = {
  bash: 'bash',
  zsh: 'zsh',
  fish: 'fish',
  cmd: 'cmd.exe',
  'cmd.exe': 'cmd.exe',
  pwsh: 'powershell',
  powershell: 'powershell',
  'powershell.exe': 'powershell',
}

/** Return the process-wide Freebuff fingerprint, computing it only once. */
export function getFingerprintId(): Promise<string> {
  cachedFingerprintPromise ??= calculateFingerprint()
  return cachedFingerprintPromise
}

/** Generate the official enhanced fingerprint, falling back to the legacy form. */
export async function calculateFingerprint(): Promise<string> {
  try {
    return await calculateEnhancedFingerprint()
  } catch {
    return calculateLegacyFingerprint()
  }
}

/** Generate the legacy Freebuff CLI fingerprint used when hardware lookup fails. */
export function calculateLegacyFingerprint(): string {
  return `codebuff-cli-${randomBytes(6).toString('base64url').substring(0, 8)}`
}

async function calculateEnhancedFingerprint(): Promise<string> {
  const machineId = await getMachineId()
  const [systemInfo, shell, networkInfo] = await Promise.all([
    getSystemInfo(),
    Promise.resolve(detectShell()),
    Promise.resolve(networkInterfaces()),
  ])
  const macAddresses = Object.values(networkInfo)
    .flat()
    .filter(iface => iface !== undefined && !iface.internal && iface.mac !== '00:00:00:00:00:00' && iface.mac.length > 0)
    .map(iface => iface!.mac)
    .sort()
  const fingerprintInfo = {
    system: systemInfo.system,
    cpu: systemInfo.cpu,
    os: systemInfo.os,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      shell,
      cpuCount: cpus().length,
    },
    network: {
      macAddresses,
      interfaceCount: Object.keys(networkInfo).length,
    },
    machineId,
    fingerprintVersion: '2.0',
  }
  const hash = createHash('sha256').update(JSON.stringify(fingerprintInfo)).digest('base64url')
  return `enhanced-${hash}`
}

async function getMachineId(): Promise<string> {
  machineIdModule ??= await import('node-machine-id')
  const id = await machineIdModule.machineId()
  if (!id || id === 'unknown' || id.length < 8) throw new Error('Invalid machine ID returned')
  return id
}

async function getSystemInfo(): Promise<{
  system: { manufacturer: string; model: string; serial: string; uuid: string }
  cpu: { manufacturer: string; brand: string; cores: number; physicalCores: number }
  os: { platform: string; distro: string; arch: string; hostname: string }
}> {
  try {
    systemInformationModule ??= await import('systeminformation')
    const [system, cpu, os] = await Promise.all([
      systemInformationModule.system(),
      systemInformationModule.cpu(),
      systemInformationModule.osInfo(),
    ])
    return {
      system: { manufacturer: system.manufacturer, model: system.model, serial: system.serial, uuid: system.uuid },
      cpu: { manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores, physicalCores: cpu.physicalCores },
      os: { platform: os.platform, distro: os.distro, arch: os.arch, hostname: os.hostname },
    }
  } catch {
    return {
      system: { manufacturer: '', model: '', serial: '', uuid: '' },
      cpu: { manufacturer: '', brand: '', cores: 0, physicalCores: 0 },
      os: { platform: process.platform, distro: '', arch: process.arch, hostname: '' },
    }
  }
}

function detectShell(): ShellName {
  if (cachedShell !== undefined) return cachedShell
  const candidates = process.platform === 'win32'
    ? [process.env.COMSPEC, process.env.SHELL]
    : [process.env.SHELL]
  for (const candidate of candidates) {
    const normalized = normalizeShell(candidate)
    if (normalized !== undefined) {
      cachedShell = normalized
      return normalized
    }
  }
  const fromParent = detectShellFromParentProcess()
  if (fromParent !== undefined) {
    cachedShell = fromParent
    return fromParent
  }
  cachedShell = 'unknown'
  return cachedShell
}

function detectShellFromParentProcess(): ShellName | undefined {
  try {
    const output = process.platform === 'win32'
      ? execFileSync('wmic', ['process', 'get', 'ParentProcessId,CommandLine'], { stdio: 'pipe' }).toString().toLowerCase()
      : execFileSync('ps', ['-p', String(process.ppid), '-o', 'comm='], { stdio: 'pipe' }).toString()
    if (process.platform === 'win32') {
      if (output.includes('powershell')) return 'powershell'
      if (output.includes('cmd.exe')) return 'cmd.exe'
    }
    for (const candidate of output.split(/\r?\n/u)) {
      const normalized = normalizeShell(candidate)
      if (normalized !== undefined) return normalized
    }
  } catch {
    return undefined
  }
  return undefined
}

function normalizeShell(value: string | undefined): ShellName | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  const lower = value.trim().toLowerCase()
  const last = lower.split(/[\\/]/u).pop() ?? lower
  const base = last.endsWith('.exe') ? last.slice(0, -4) : last
  return SHELL_ALIASES[base] ?? SHELL_ALIASES[last] ?? (base.endsWith('sh') ? base : undefined)
}
