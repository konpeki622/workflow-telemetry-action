import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import axios from 'axios'
import * as core from '@actions/core'
import {
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

async function triggerStatCollect(): Promise<void> {
  logger.debug('Triggering stat collect ...')
  const response = await axios.post(
    `http://localhost:${STAT_SERVER_PORT}/collect`
  )
  if (logger.isDebugEnabled()) {
    logger.debug(`Triggered stat collect: ${JSON.stringify(response.data)}`)
  }
}

async function reportWorkflowMetrics(): Promise<string> {
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

  const { userLoadX, systemLoadX, cpuTableContent } = await getCPUStats()
  const { activeMemoryX, availableMemoryX, memoryTableContent } = await getMemoryStats()
  const { networkReadX, networkWriteX, networkTableContent } = await getNetworkStats()
  const { diskReadX, diskWriteX, diskTableContent } = await getDiskStats()

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
    activeMemoryX.length &&
    availableMemoryX &&
    availableMemoryX.length
      ? await getStackedAreaGraph({
          label: 'Memory Usage (MB)',
          axisColor,
          areas: [
            {
              label: 'Used',
              color: '#377eb899',
              points: activeMemoryX
            },
            {
              label: 'Free',
              color: '#4daf4a99',
              points: availableMemoryX
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
  if (cpuTableContent) {
    postContentItems.push(
      markdownTable(cpuTableContent)
    )
  }
  if (memoryUsage) {
    postContentItems.push(
      '### Memory Metrics',
      `![${memoryUsage.id}](${memoryUsage.url})`,
      ''
    )
  }
  if (memoryTableContent) {
    postContentItems.push(
      markdownTable(memoryTableContent)
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
  if (networkTableContent) {
    postContentItems.push(
      '### Network I/O details',
      markdownTable(networkTableContent)
    )
  }
  if (diskTableContent) {
    postContentItems.push(
      '### Disk I/O details',
      markdownTable(diskTableContent)
    )
  }
  return postContentItems.join('\n')
}

async function getCPUStats(): Promise<ProcessedCPUStats> {
  const userLoadX: ProcessedStats[] = []
  const systemLoadX: ProcessedStats[] = []
  const cpuTableContent: string[][] = []

  logger.debug('Getting CPU stats ...')
  const response = await axios.get(`http://localhost:${STAT_SERVER_PORT}/cpu`)
  if (logger.isDebugEnabled()) {
    logger.debug(`Got CPU stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = response.data[0].time
  let maxUserValue: number = 0
  let sumUserValue: number = 0
  let maxSystemValue: number = 0
  let sumSystemValue: number = 0

  cpuTableContent.push(['Time', 'Value(user)', 'Value(system)']) // header
  response.data.forEach((element: CPUStats) => {
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

    const currentTime: string = Math.round((element.time - startTime) / 1000).toString()
    cpuTableContent.push([`${currentTime}s`, `${userLoad.toFixed(2)}%`, `${systemLoad.toFixed(2)}%`])
  })
  cpuTableContent.push(['**Max**', `**${maxUserValue.toFixed(2)}%**`, `**${maxSystemValue.toFixed(2)}%**`])
  cpuTableContent.push(['**Avg**', `**${(sumUserValue / response.data.length).toFixed(2)}%**`, `**${(sumSystemValue / response.data.length).toFixed(2)}%**`])

  return { userLoadX, systemLoadX, cpuTableContent }
}

async function getMemoryStats(): Promise<ProcessedMemoryStats> {
  const activeMemoryX: ProcessedStats[] = []
  const availableMemoryX: ProcessedStats[] = []
  const memoryTableContent: string[][] = []

  logger.debug('Getting memory stats ...')
  const response = await axios.get(
    `http://localhost:${STAT_SERVER_PORT}/memory`
  )
  if (logger.isDebugEnabled()) {
    logger.debug(`Got memory stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = response.data[0].time
  let maxUsedValue: number = 0
  let sumUsedValue: number = 0
  let totalMemoryMb: number = 0
  let sumTotalMemoryMb: number = 0 // to calculate average value

  memoryTableContent.push(['Time', 'Usage', 'Rate']) // header
  response.data.forEach((element: MemoryStats) => {
    const activeMemoryMb = element.activeMemoryMb && element.activeMemoryMb > 0 ? element.activeMemoryMb : 0
    activeMemoryX.push({
      x: element.time,
      y: activeMemoryMb
    })

    availableMemoryX.push({
      x: element.time,
      y:
        element.availableMemoryMb && element.availableMemoryMb > 0
          ? element.availableMemoryMb
          : 0
    })

    maxUsedValue = Math.max(maxUsedValue, activeMemoryMb)
    sumUsedValue += activeMemoryMb
    totalMemoryMb = Math.max(totalMemoryMb, element.totalMemoryMb)
    sumTotalMemoryMb += totalMemoryMb

    const currentTime: string = Math.round((element.time - startTime) / 1000).toString()
    memoryTableContent.push([`${currentTime}s`, `${activeMemoryMb.toFixed(2)}M`, `${(activeMemoryMb / element.totalMemoryMb).toFixed(2)}%`])
  })
  memoryTableContent.push(['**Max**', `**${maxUsedValue.toFixed(2)}M**`, `**${(maxUsedValue / totalMemoryMb).toFixed(2)}%**`])
  memoryTableContent.push(['**Avg**', `**${(sumUsedValue / response.data.length).toFixed(2)}M**`, `**${(sumUsedValue / sumTotalMemoryMb).toFixed(2)}%**`])

  return { activeMemoryX, availableMemoryX, memoryTableContent }
}

async function getNetworkStats(): Promise<ProcessedNetworkStats> {
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

  const startTime: number = response.data[0].time
  let maxReadValue: number = 0
  let maxWriteValue: number = 0

  networkTableContent.push(['Time', 'Read', 'Write']) // header
  response.data.forEach((element: NetworkStats) => {
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

    const currentTime: string = Math.round((element.time - startTime) / 1000).toString()
    networkTableContent.push([`${currentTime}s`, `${rxMb.toFixed(2)}M`, `${txMb.toFixed(2)}M`])
  })
  networkTableContent.push(['**Max**', `**${maxReadValue.toFixed(2)}M**`, `**${maxWriteValue.toFixed(2)}M**`])

  return { networkReadX, networkWriteX, networkTableContent }
}

async function getDiskStats(): Promise<ProcessedDiskStats> {
  const diskReadX: ProcessedStats[] = []
  const diskWriteX: ProcessedStats[] = []
  const diskTableContent: string[][] = []

  logger.debug('Getting disk stats ...')
  const response = await axios.get(`http://localhost:${STAT_SERVER_PORT}/disk`)
  if (logger.isDebugEnabled()) {
    logger.debug(`Got disk stats: ${JSON.stringify(response.data)}`)
  }

  const startTime: number = response.data[0].time
  let maxReadValue: number = 0
  let maxWriteValue: number = 0

  diskTableContent.push(['Time', 'Read', 'Write']) // header
  response.data.forEach((element: DiskStats) => {
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

    const currentTime: string = Math.round((element.time - startTime) / 1000).toString()
    diskTableContent.push([`${currentTime}s`, `${rxMb.toFixed(2)}M`, `${wxMb.toFixed(2)}M`])
  })
  diskTableContent.push(['**Max**', `**${maxReadValue.toFixed(2)}M**`, `**${maxWriteValue.toFixed(2)}M**`])

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

export async function report(
  currentJob: WorkflowJobType
): Promise<string | null> {
  logger.info(`Reporting stat collector result ...`)

  try {
    const postContent: string = await reportWorkflowMetrics()

    logger.info(`Reported stat collector result`)

    return postContent
  } catch (error: any) {
    logger.error('Unable to report stat collector result')
    logger.error(error)

    return null
  }
}
