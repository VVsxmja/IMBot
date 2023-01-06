// logger

import logger from './logger.js'
logger.info('程序已开始运行')
process.on('exit', () => {
    console.info('程序已退出')
})

// go-cqhttp

try {
    const connect = (await import('./go-cqhttp/runner.js')).default
    await connect()
    logger.info('go-cqhttp 已开始运行')
} catch {
    console.error('go-cqhttp 启动失败，程序即将退出')
    process.exit()
}

// 正向 WebSocket 连接 go-cqhttp 服务器

import WebSocket from 'ws'
const ws = new WebSocket('ws://127.0.0.1:3050')

ws.onopen = (event) => {
    logger.info('程序已连接到 go-cqhttp 服务')
    logger.info(event)
}

ws.onclose = (event) => {
    logger.error('程序和 go-cqhttp 服务的连接已断开，程序即将退出')
}

ws.onmessage = (event) => {
    logger.info(event.data)
}