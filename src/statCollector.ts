import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import axios from 'axios'
import * as core from '@actions/core'
import {
  CompletedCommand,
  CPUStats,
  DiskStats,
  GraphResponse,
  LineGraphOptions,
  MemoryStats,
  NetworkStats,
  ProcessedCPUStats,
  ProcessedDiskStats,
  ProcessedMemoryStats,
  ProcessedNetworkStats,
  ProcessedStats,
  StackedAreaGraphOptions,
  WorkflowJobType
} from './interfaces'
import * as logger from './logger'
import { markdownTable } from 'markdown-table'

const STAT_SERVER_PORT = 7777

const BLACK = '#000000'
const WHITE = '#FFFFFF'

const VALID_JOB_NAME = 'Run test'

async function triggerStatCollect(): Promise<void> {
  logger.debug('Triggering stat collect ...')
  const response = await axios.post(
    `http://localhost:${STAT_SERVER_PORT}/collect`
  )
  if (logger.isDebugEnabled()) {
    logger.debug(`Triggered stat collect: ${JSON.stringify(response.data)}`)
  }
}

// @konpeki622: display `Performance Statistics`
async function reportWorkflowMetrics(job: WorkflowJobType): Promise<string> {
  const validJob: any = job.steps?.find(step => step.name === VALID_JOB_NAME && step.started_at && step.completed_at)
  if (!validJob) {
    logger.error('No valid Job.')
    return ''
  }
  logger.debug(`test job ===> ${JSON.stringify(validJob)}`)
  
  const theme: string = core.getInput('theme', { required: false })
  let axisColor = BLACK
  switch (theme) {
    case 'light':
      axisColor = BLACK
      break
    case 'dark':
      axisColor = WHITE
      break
    default:
      core.warning(`Invalid theme: ${theme}`)
  }

  const { userLoadX, systemLoadX, cpuTableContent } = await getCPUStats(validJob)
  const { activeMemoryX, memoryTableContent } = await getMemoryStats(validJob)
  const { networkReadX, networkWriteX, networkTableContent } = await getNetworkStats(validJob)
  const { diskReadX, diskWriteX, diskTableContent } = await getDiskStats(validJob)

  const cpuLoad =
    userLoadX && userLoadX.length && systemLoadX && systemLoadX.length
      ? await getStackedAreaGraph({
          label: 'CPU Load (%)',
          axisColor,
          areas: [
            {
              label: 'User Load',
              color: '#e41a1c99',
              points: userLoadX
            },
            {
              label: 'System Load',
              color: '#ff7f0099',
              points: systemLoadX
            }
          ]
        })
      : null

  const memoryUsage =
    activeMemoryX &&
    activeMemoryX.length
      ? await getStackedAreaGraph({
          label: 'Memory Usage (MB)',
          axisColor,
          areas: [
            {
              label: 'Used',
              color: '#377eb899',
              points: activeMemoryX
            }
          ]
        })
      : null

  const networkIORead =
    networkReadX && networkReadX.length
      ? await getLineGraph({
          label: 'Network I/O Read (MB)',
          axisColor,
          line: {
            label: 'Read',
            color: '#be4d25',
            points: networkReadX
          }
        })
      : null

  const networkIOWrite =
    networkWriteX && networkWriteX.length
      ? await getLineGraph({
          label: 'Network I/O Write (MB)',
          axisColor,
          line: {
            label: 'Write',
            color: '#6c25be',
            points: networkWriteX
          }
        })
      : null

  const diskIORead =
    diskReadX && diskReadX.length
      ? await getLineGraph({
          label: 'Disk I/O Read (MB)',
          axisColor,
          line: {
            label: 'Read',
            color: '#be4d25',
            points: diskReadX
          }
        })
      : null

  const diskIOWrite =
    diskWriteX && diskWriteX.length
      ? await getLineGraph({
          label: 'Disk I/O Write (MB)',
          axisColor,
          line: {
            label: 'Write',
            color: '#6c25be',
            points: diskWriteX
          }
        })
      : null

  const postContentItems: string[] = []
  if (cpuLoad) {
    postContentItems.push(
      '### CPU Metrics',
      `![${cpuLoad.id}](${cpuLoad.url})`,
      ''
    )
  }
  if (memoryUsage) {
    postContentItems.push(
      '### Memory Metrics',
      `![${memoryUsage.id}](${memoryUsage.url})`,
      ''
    )
  }
  if ((networkIORead && networkIOWrite) || (diskIORead && diskIOWrite)) {
    postContentItems.push(
      '### IO Metrics',
      '|               | Read      | Write     |',
      '|---            |---        |---        |'
    )
  }
  if (networkIORead && networkIOWrite) {
    postContentItems.push(
      `| Network I/O   | ![${networkIORead.id}](${networkIORead.url})        | ![${networkIOWrite.id}](${networkIOWrite.url})        |`
    )
  }
  if (diskIORead && diskIOWrite) {
    postContentItems.push(
      `| Disk I/O      | ![${diskIORead.id}](${diskIORead.url})              | ![${diskIOWrite.id}](${diskIOWrite.url})              |`
    )
  }

  if (validJob.started_at && validJob.completed_at) {
    const duration = Math.round((new Date(validJob.completed_at).getTime() - new Date(validJob.started_at).getTime()) / 1000)
    postContentItems.push(
      '### Performance Statistics',
      `Executing duration: ${duration}s`
    )
    const tableContent: string[][] = []
    tableContent.push(['Domain', 'MaxValue', 'AvgValue'])
    if (cpuTableContent && cpuTableContent.length) {
      tableContent.push(...cpuTableContent)
    }
    if (memoryTableContent && memoryTableContent.length) {
      tableContent.push(...memoryTableContent)
    }
    if (networkTableContent && networkTableContent.length) {
      tableContent.push(...networkTableContent)
    }
    if (diskTableContent && diskTableContent.length) {
      tableContent.push(...diskTableContent)
    }
    postContentItems.push(markdownTable(tableContent))
  }
  return postContentItems.join('\n')
}

// @konpeki622: add cpu table content
async function getCPUStats(validJob: any): Promise<ProcessedCPUStats> {
  const userLoadX: ProcessedStats[] = []
  const systemLoadX: ProcessedStats[] = []
  const cpuTableContent: string[][] = []

  logger.debug('Getting CPU stats ...')
  const response = await axios.get(`http://localhost:${STAT_SERVER_PORT}/cpu`)
  if (logger.isDebugEnabled()) {
    logger.debug(`Got CPU stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = new Date(validJob.started_at).getTime()
  const endTime: number = new Date(validJob.completed_at).getTime()

  let maxUserValue: number = 0
  let sumUserValue: number = 0
  let maxSystemValue: number = 0
  let sumSystemValue: number = 0
  let times: number = 0

  response.data.forEach((element: CPUStats) => {
    if (element.time < startTime || element.time > endTime) {
      return true
    }

    const userLoad: number = element.userLoad && element.userLoad > 0 ? element.userLoad : 0
    userLoadX.push({
      x: element.time,
      y: userLoad
    })
    maxUserValue = Math.max(maxUserValue, element.userLoad)
    sumUserValue += userLoad

    const systemLoad: number = element.systemLoad && element.systemLoad > 0 ? element.systemLoad : 0
    systemLoadX.push({
      x: element.time,
      y: systemLoad
    })

    maxSystemValue = Math.max(maxSystemValue, element.systemLoad)
    sumSystemValue += systemLoad
    ++times
  })
  cpuTableContent.push(['CPU(user)', `${maxUserValue.toFixed(2)}%`, `${(sumUserValue / times).toFixed(2)}%`])
  cpuTableContent.push(['CPU(sys)', `${maxSystemValue.toFixed(2)}%`, `${(sumSystemValue / times).toFixed(2)}%`])

  return { userLoadX, systemLoadX, cpuTableContent }
}

// @konpeki622: add memory table content
async function getMemoryStats(validJob: any): Promise<ProcessedMemoryStats> {
  const activeMemoryX: ProcessedStats[] = []
  const memoryTableContent: string[][] = []

  logger.debug('Getting memory stats ...')
  const response = await axios.get(
    `http://localhost:${STAT_SERVER_PORT}/memory`
  )
  if (logger.isDebugEnabled()) {
    logger.debug(`Got memory stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = new Date(validJob.started_at).getTime()
  const endTime: number = new Date(validJob.completed_at).getTime()

  let maxUsedValue: number = 0
  let sumUsedValue: number = 0
  let totalMemoryMb: number = 0
  let sumTotalMemoryMb: number = 0 // to calculate average value
  let times: number = 0

  response.data.forEach((element: MemoryStats, index: number) => {
    if (element.time < startTime || element.time > endTime) {
      return true
    }

    const activeMemoryMb = element.activeMemoryMb && element.activeMemoryMb > 0 ? element.activeMemoryMb : 0
    activeMemoryX.push({
      x: element.time,
      y: activeMemoryMb
    })

    maxUsedValue = Math.max(maxUsedValue, activeMemoryMb)
    sumUsedValue += activeMemoryMb
    totalMemoryMb = Math.max(totalMemoryMb, element.totalMemoryMb)
    sumTotalMemoryMb += totalMemoryMb
    ++times
  })
  memoryTableContent.push(['Memory', `${maxUsedValue.toFixed(2)}M(${(maxUsedValue / totalMemoryMb).toFixed(2)}%)`, `${(sumUsedValue / times).toFixed(2)}M(${(sumUsedValue / sumTotalMemoryMb).toFixed(2)}%)`])

  return { activeMemoryX, memoryTableContent }
}

// @konpeki622: add network table content
async function getNetworkStats(validJob: any): Promise<ProcessedNetworkStats> {
  const networkReadX: ProcessedStats[] = []
  const networkWriteX: ProcessedStats[] = []
  const networkTableContent: string[][] = []

  logger.debug('Getting network stats ...')
  const response = await axios.get(
    `http://localhost:${STAT_SERVER_PORT}/network`
  )
  if (logger.isDebugEnabled()) {
    logger.debug(`Got network stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = new Date(validJob.started_at).getTime()
  const endTime: number = new Date(validJob.completed_at).getTime()

  let maxReadValue: number = 0
  let maxWriteValue: number = 0
  let times: number = 0

  response.data.forEach((element: NetworkStats, index: number) => {
    if (element.time < startTime || element.time > endTime) {
      return true
    }

    const rxMb = element.rxMb && element.rxMb > 0 ? element.rxMb : 0
    networkReadX.push({
      x: element.time,
      y: rxMb
    })
    const txMb = element.txMb && element.txMb > 0 ? element.txMb : 0
    networkWriteX.push({
      x: element.time,
      y: txMb
    })

    maxReadValue = Math.max(maxReadValue, element.rxMb)
    maxWriteValue = Math.max(maxWriteValue, element.txMb)
    ++times
  })
  networkTableContent.push(['Network I/O Read', `${maxReadValue.toFixed(2)}M`, '-'])
  networkTableContent.push(['Network I/O Write', `${maxWriteValue.toFixed(2)}M`, '-'])

  return { networkReadX, networkWriteX, networkTableContent }
}

// @konpeki622: add disk table content
async function getDiskStats(validJob: any): Promise<ProcessedDiskStats> {
  const diskReadX: ProcessedStats[] = []
  const diskWriteX: ProcessedStats[] = []
  const diskTableContent: string[][] = []

  logger.debug('Getting disk stats ...')
  const response = await axios.get(`http://localhost:${STAT_SERVER_PORT}/disk`)
  if (logger.isDebugEnabled()) {
    logger.debug(`Got disk stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = new Date(validJob.started_at).getTime()
  const endTime: number = new Date(validJob.completed_at).getTime()

  let maxReadValue: number = 0
  let maxWriteValue: number = 0
  let times: number = 0

  response.data.forEach((element: DiskStats, index: number) => {
    if (element.time < startTime || element.time > endTime) {
      return true
    }
    const rxMb = element.rxMb && element.rxMb > 0 ? element.rxMb : 0
    diskReadX.push({
      x: element.time,
      y: rxMb
    })
    const wxMb = element.wxMb && element.wxMb > 0 ? element.wxMb : 0
    diskWriteX.push({
      x: element.time,
      y: wxMb
    })

    maxReadValue = Math.max(maxReadValue, element.rxMb)
    maxWriteValue = Math.max(maxWriteValue, element.wxMb)
    ++times
  })
  diskTableContent.push(['Disk I/O Read', `${maxReadValue.toFixed(2)}M`, '-'])
  diskTableContent.push(['Disk I/O Write', `${maxWriteValue.toFixed(2)}M`, '-'])

  return { diskReadX, diskWriteX, diskTableContent }
}

async function getLineGraph(options: LineGraphOptions): Promise<GraphResponse> {
  const payload = {
    options: {
      width: 1000,
      height: 500,
      xAxis: {
        label: 'Time'
      },
      yAxis: {
        label: options.label
      },
      timeTicks: {
        unit: 'auto'
      }
    },
    lines: [options.line]
  }

  let response = null
  try {
    response = await axios.put(
      'https://api.globadge.com/v1/chartgen/line/time',
      payload
    )
  } catch (error: any) {
    logger.error(error)
    logger.error(`getLineGraph ${JSON.stringify(payload)}`)
  }

  return response?.data
}

async function getStackedAreaGraph(
  options: StackedAreaGraphOptions
): Promise<GraphResponse> {
  const payload = {
    options: {
      width: 1000,
      height: 500,
      xAxis: {
        label: 'Time'
      },
      yAxis: {
        label: options.label
      },
      timeTicks: {
        unit: 'auto'
      }
    },
    areas: options.areas
  }

  let response = null
  try {
    response = await axios.put(
      'https://api.globadge.com/v1/chartgen/stacked-area/time',
      payload
    )
  } catch (error: any) {
    logger.error(error)
    logger.error(`getStackedAreaGraph ${JSON.stringify(payload)}`)
  }
  return response?.data
}

///////////////////////////

export async function start(): Promise<boolean> {
  logger.info(`Starting stat collector ...`)

  try {
    let metricFrequency = 0
    const metricFrequencyInput: string = core.getInput('metric_frequency')
    if (metricFrequencyInput) {
      const metricFrequencyVal: number = parseInt(metricFrequencyInput)
      if (Number.isInteger(metricFrequencyVal)) {
        metricFrequency = metricFrequencyVal * 1000
      }
    }

    const child: ChildProcess = spawn(
      process.argv[0],
      [path.join(__dirname, '../scw/index.js')],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          WORKFLOW_TELEMETRY_STAT_FREQ: metricFrequency
            ? `${metricFrequency}`
            : undefined
        }
      }
    )
    child.unref()

    logger.info(`Started stat collector`)

    return true
  } catch (error: any) {
    logger.error('Unable to start stat collector')
    logger.error(error)

    return false
  }
}

export async function finish(currentJob: WorkflowJobType): Promise<boolean> {
  logger.info(`Finishing stat collector ...`)

  try {
    // Trigger stat collect, so we will have remaining stats since the latest schedule
    await triggerStatCollect()

    logger.info(`Finished stat collector`)

    return true
  } catch (error: any) {
    logger.error('Unable to finish stat collector')
    logger.error(error)

    return false
  }
}

// @konpeki622: transfer currentJob
export async function report(
  currentJob: WorkflowJobType
): Promise<string | null> {
  logger.info(`Reporting stat collector result ...`)

  if (!currentJob) {
    return null
  }

  try {
    const postContent: string = await reportWorkflowMetrics(currentJob)

    logger.info(`Reported stat collector result`)

    return postContent
  } catch (error: any) {
    logger.error('Unable to report stat collector result')
    logger.error(error)

    return null
  }
}
