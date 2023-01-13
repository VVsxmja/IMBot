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
} catch (err) {
    console.error('go-cqhttp 启动失败，程序即将退出')
    console.error(err)
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
import { CloneEvent, ParseCommand } from './message_format.js'
const bot = {
    activeProfiles: [],
    eventQueueLock: new Mutex(),
    async pushEvent(event) {
        await this.eventQueueLock.runExclusive(async () => this.handleEvent(event))
    },
    async callCommand(command, args, context) {
        let inst = command.action(context, args)
        if (!(await inst.next()).done) {
            // TODO: 添加 `session`
            logger.warn('有一个命令的动作未在一步内结束，由于程序暂时无法创建 session ，后续的步骤将不会执行')
        }
    },
    async callMiddleware(middleware, context) {
        let inst = middleware.action(context)
        if (!(await inst.next()).done) {
            // TODO: 添加 `session`
            logger.warn('有一个中间件的动作未在一步内结束，由于程序暂时无法创建 session ，后续的步骤将不会执行')
        }
    },
    async handleEvent(event) {
        logger.trace({
            msg: '收到事件',
            event: event,
        })

        // TODO: `session` 先响应事件

        for (const profile of this.activeProfiles) {

            // 假定包含 `group_id` 的事件都是群事件

            if (profile.profile.type === 'group' && (!!event.group_id || event.post_type === 'meta_event')) {

                // 如果不是当前 profile 所属的群，则不处理
                if (!profile.profile.groups.map(g => g.group_id).includes(event.group_id)) continue

                const context = {
                    event: CloneEvent(event),
                    profile: profile,
                    bot: this
                }

                // 先判断事件是否满足命令形式

                let command
                try {
                    command = ParseCommand(event)
                } catch (err) {
                    if (err.message === '引号不匹配') {
                        await this.useAPI({
                            action: 'send_msg',
                            params: {
                                detail_type: 'group',
                                group_id: event.group_id,
                                message: [
                                    { type: 'reply', data: { id: event.message_id } },
                                    { type: 'text', data: { text: '命令格式错误：引号不匹配' } }
                                ]
                            }
                        })
                    } else {
                        logger.error(err)
                        await this.useAPI({
                            action: 'send_msg',
                            params: {
                                detail_type: 'group',
                                group_id: event.group_id,
                                message: [
                                    { type: 'reply', data: { id: event.message_id } },
                                    { type: 'text', data: { text: '解析命令时遇到未知错误' } }
                                ]
                            }
                        })
                    }
                }
                if (command) {
                    const commands = profile.activePlugins.flatMap(i => i.command).filter(x => x?.command === command.command)
                    if (commands.length !== 0) {
                        if (commands.length === 1) {
                            await this.callCommand(commands[0], command.args, context)
                        } else {
                            // 找到了不止一个命令
                            logger.fatal({
                                msg: `对于 ${command} 命令，找到了 ${commands.length} 个匹配`,
                                profile,
                                event,
                            })
                        }
                    } else {
                        await this.useAPI({
                            action: 'send_msg',
                            params: {
                                detail_type: 'group',
                                group_id: event.group_id,
                                message: [
                                    { type: 'reply', data: { id: event.message_id } },
                                    { type: 'text', data: { text: `${command.command} 命令不存在` } }
                                ]
                            }
                        })
                    }
                }

                // 调用所有中间件处理事件

                const middlewares = profile.activePlugins.flatMap(i => i.middleware)
                for (const i of middlewares) {
                    if (!i) continue // 跳过没有中间件的插件
                    if (await i.match(context)) {
                        await this.callMiddleware(i, context)
                        if (!(i?.pass)) break
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
        } catch (err) {
            logger.error(`无法从 ${path} 载入 profile`)
            throw err
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
                    } catch (err) {
                        logger.error(`从 ./plugins/${plugin.name}/${plugin.name}.js 载入插件 ${plugin.name} 失败`)
                        throw err
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
                        throw Error()
                    }
                    profile.activePlugins.push(pluginObject)
                } else {
                    logger.warn(`插件 ${plugin.name} 载入方式有误`)
                    throw Error()
                }
            }
        } catch (err) {
            logger.error(`载入 profile "${profile.profile.name}" 失败`)
            throw err
        }
        this.activeProfiles.push(profile)
        logger.info(`已经载入 profile "${profile.profile.name}"`)
    },
    async useAPI(request) {
        // TODO: 获取响应消息

        logger.trace({
            msg: '调用了 API',
            request,
        })
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