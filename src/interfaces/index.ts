// eslint-disable-next-line import/no-unresolved
import { components } from '@octokit/openapi-types'

export type WorkflowJobType = components['schemas']['job']

export interface CPUStats {
  readonly time: number
  readonly totalLoad: number
  readonly userLoad: number
  readonly systemLoad: number
}

export interface MemoryStats {
  readonly time: number
  readonly totalMemoryMb: number
  readonly activeMemoryMb: number
  readonly availableMemoryMb: number
}

export interface NetworkStats {
  readonly time: number
  readonly rxMb: number
  readonly txMb: number
}

export interface DiskStats {
  readonly time: number
  readonly rxMb: number
  readonly wxMb: number
}

export interface ProcessedStats {
  readonly x: number
  readonly y: number
}

export interface ProcessedCPUStats {
  readonly userLoadX: ProcessedStats[]
  readonly systemLoadX: ProcessedStats[]
  readonly cpuTableContent: string[][]
}

export interface ProcessedMemoryStats {
  readonly activeMemoryX: ProcessedStats[]
  readonly memoryTableContent: string[][]
}

export interface ProcessedNetworkStats {
  readonly networkReadX: ProcessedStats[]
  readonly networkWriteX: ProcessedStats[]
  readonly networkTableContent: string[][]
}

export interface ProcessedDiskStats {
  readonly diskReadX: ProcessedStats[]
  readonly diskWriteX: ProcessedStats[]
  readonly diskTableContent: string[][]
}

export interface LineGraphOptions {
  readonly label: string
  readonly axisColor: string
  readonly line: {
    readonly label: string
    readonly color: string
    readonly points: ProcessedStats[]
  }
}

export interface StackedArea {
  readonly label: string
  readonly color: string
  readonly points: ProcessedStats[]
}

export interface StackedAreaGraphOptions {
  readonly label: string
  readonly axisColor: string
  readonly areas: StackedArea[]
}

export interface GraphResponse {
  readonly id: string
  readonly url: string
}

export interface CompletedCommand {
  readonly ts: string
  readonly event: string
  readonly name: string
  readonly uid: number
  readonly pid: number
  readonly ppid: string
  readonly startTime: number
  readonly fileName: string
  readonly args: string[]
  readonly duration: number
  readonly exitCode: number
  readonly order: number
}

export interface ProcEventParseOptions {
  readonly minDuration: number
  readonly traceSystemProcesses: boolean
}
