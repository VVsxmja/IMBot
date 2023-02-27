import logger from '../logger.js'

import gocqhttp from 'go-cqhttp'

export async function connect() {
    // 参考了 https://github.com/koishijs/koishi-plugin-gocqhttp/blob/master/src/index.ts
    return new Promise((resolve, reject) => {
        const botProcess = gocqhttp({ faststart: true })

        botProcess.stdout.on('data', async (data) => {
            data = data.toString().trim()
            if (!data) return
            for (const line of data.trim().split('\n')) {
                if (line.includes('アトリは、高性能ですから')) {
                    resolve()
                } else if (line.includes('未找到配置文件')) {
                    logger.error('配置文件不存在，请参考 config.default.yml 以及 go-cqhttp 文档，编写好 config.yml 再运行')
                    reject(new Error())
                }
            }
        })

        botProcess.on('exit', () => {
            logger.error('go-cqhttp 已退出')
            reject(new Error())
        })
    })
}