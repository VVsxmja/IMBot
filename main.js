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
const ws = new WebSocket('ws://127.0.0.1:3050') // 端口号见 `config.yml`

ws.onopen = () => {
    logger.info('程序已连接到 go-cqhttp 服务')
}

ws.onclose = () => {
    logger.error('程序和 go-cqhttp 服务的连接已断开，程序即将退出')
}

ws.onmessage = (eventMessage) => {
    let event
    try {
        event = JSON.parse(eventMessage.data)
    } catch {
        logger.warn(`收到非 JSON 格式消息，已忽略：${eventMessage.data}`)
        return
    }
    bot.pushEvent(event)
}

import * as fs from 'fs/promises'
import { Mutex } from 'async-mutex'
import { TrimMessage } from './message_format.js'
const CloneEvent = (event) => JSON.parse(JSON.stringify(event))
const bot = {
    activeProfiles: [],
    eventQueueLock: new Mutex(),
    async pushEvent(event) {
        await this.eventQueueLock.runExclusive(async () => this.handleEvent(event))
    },
    async handleCommandEvent(event) {
        // WIP
    },
    async callCommand(event) {
        // WIP
    },
    async callMiddleware(event, middleware, context) {
        let inst = middleware.action(event, context)
        if (!(await inst.next()).done) {
            // WIP：添加 `session`
            logger.warn('有一个中间件的动作未在一步内结束，由于程序暂时无法创建 session ，后续的步骤将不会执行')
        }
    },
    async handleEvent(event) {
        for (const profile of this.activeProfiles) {

            // 假定包含 `group_id` 的事件都是群事件

            if (profile.profile.type === 'group' && (!!event.group_id || event.post_type === 'meta_event')) {

                // WIP：`session` 响应事件

                // 先判断事件是否满足命令形式

                if (event.post_type === 'message') {
                    const trimmed = TrimMessage(event)
                    if (trimmed.message.length > 0 && trimmed.message[0].type === 'text') {
                        if (/^\//.test(trimmed.message[0].data.text)) {
                            return this.handleCommandEvent(trimmed)
                        }
                    }
                }

                // 调用所有中间件处理事件

                if (profile.profile.groups.flatMap(g => g.group_id).includes(event.group_id)) {
                    const middlewares = profile.activePlugins.flatMap(i => i.middleware)
                    for (const i of middlewares) {
                        if (await i.match(CloneEvent(event))) {
                            await this.callMiddleware(CloneEvent(event), i, {
                                profile: profile,
                                bot: this
                            })
                            if (!(i?.pass)) break
                        }
                    }
                }
            }
        }
    },
    async loadProfile(path) {
        logger.info(`正在从 ${path} 载入 profile ……`)
        let content
        try {
            content = JSON.parse(await fs.readFile(path, 'utf-8'))
        } catch {
            logger.error(`无法从 ${path} 载入 profile`)
            throw new Error()
        }
        let profile = {
            profile: content,
            path: path,
            activePlugins: []
        }
        try {
            for (const plugin of profile.profile.plugins) {
                if (plugin?.load_method === 'import') {
                    let pluginObject
                    try {
                        pluginObject = (await import(`./plugins/${plugin.name}/${plugin.name}.js`))[plugin.name]
                    } catch {
                        logger.error(`从 ./plugins/${plugin.name}/${plugin.name}.js 载入插件 ${plugin.name} 失败`)
                        throw new Error()
                    }

                    // 检查插件能否正确载入

                    let invalid = false

                    // 暂时没有对中间件的检查
                    // 检查命令是否能导入

                    const otherCommands = profile.activePlugins.map(plugin => plugin.command).flatMap(item => item.command)
                    const currentCommands = pluginObject.command.map(item => item.command)
                    for (const i of currentCommands) {
                        if (otherCommands.includes(i)) {
                            invalid = true
                            logger.warn(`插件 ${plugin.name} 试图响应已有的命令 "${i}"`);
                        }
                    }

                    // 载入插件结束

                    if (invalid) {
                        logger.error(`载入插件 ${plugin.name} 失败`)
                        throw new Error()
                    }
                    profile.activePlugins.push(pluginObject)
                } else {
                    logger.warn(`插件 ${plugin.name} 载入方式有误`)
                    throw new Error()
                }
            }
        } catch {
            logger.error(`载入 profile "${profile.profile.name}" 失败`)
            throw new Error()
        }
        this.activeProfiles.push(profile)
        logger.info(`已经载入 profile "${profile.profile.name}"`)
    },
    async useAPI(request) {
        return new Promise((resolve, reject) => {
            ws.send(JSON.stringify(request), (err) => {
                if (err) {
                    logger.error({
                        msg: '调用 API 时发生错误',
                        err,
                        request
                    })
                    reject()
                } else {
                    resolve()
                }
            })
        })
    }
}

await bot.loadProfile('./profiles/test_group.json')