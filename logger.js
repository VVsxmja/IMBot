import fs from 'fs/promises'

const logPath = 'logs'

await (async function() {
    try {
        await fs.access(`${logPath}`)
        console.log('日志文件夹已经存在')
    } catch (err) {
        await fs.mkdir(`${logPath}`)
        console.log('日志文件夹不存在，已经新建')
    }
})()

import pino from 'pino'
const pinoTransports = pino.transport({
    targets: [
        {
            level: 'trace', // FIXME: `debug` 和 `trace` 的 log 看不到
            target: 'pino/file',
            options: {
                destination: `${logPath}/tmp.log`,
            },
        },
        {
            level: 'debug',
            target: 'pino-pretty',
            options: {
                destination: 1,
            },
        }
    ]
})
const logger = pino(pinoTransports)

export default logger