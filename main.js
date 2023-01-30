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

// TODO: 把这部分改为 bot 的方法

import WebSocket from 'ws'
const ws = new WebSocket('ws://127.0.0.1:3050') // 端口号见 `config.yml`

ws.onopen = () => {
    logger.info('程序已连接到 go-cqhttp 服务')
}

ws.onclose = () => {
    logger.error('程序和 go-cqhttp 服务的连接已断开，程序即将退出')
}

ws.onmessage = (message) => {
    let obj
    try {
        obj = JSON.parse(message.data)
    } catch {
        logger.warn(`收到非 JSON 格式消息，已忽略：${message.data}`)
        return
    }
    if (Object.hasOwn(obj, 'echo')) {
        // 该消息为动作响应
        bot.dispatchResponse(obj)
    } else {
        // 该消息为事件推送
        bot.pushEvent(obj)
    }
}

const apiTimeout = 3000

import * as fs from 'fs/promises'
import { Mutex } from 'async-mutex'
import { CloneEvent, ParseCommand } from './message_format.js'
import { v4 as uuid } from 'uuid'
const bot = {
    activeProfiles: [],
    eventQueueLock: new Mutex(),
    activeSessions: [],
    responseWaitingList: {
        list: {},
        insert(resolve, reject) {
            let id = uuid()
            while (!!this.list[id]) id = uuid()
            this.list[id] = { resolve, reject }
            return id
        },
        includes(id) {
            return !!this.list[id]
        },
        call(id, response) {
            if (!this.list[id]) throw Error()
            if (response.status == 'ok') {
                this.list[id].resolve(response)
            } else {
                this.list[id].reject(response)
            }
            delete this.list[id]
        }
    },
    async pushEvent(event) {
        await this.eventQueueLock.runExclusive(async () => this.handleEvent(event))
    },
    async callCommand(command, args, context) {
        logger.info({
            msg: `调用了命令 ${command}`,
            args,
            context,
        })
        const newSession = {
            history: [],
            inst: undefined
        }
        newSession.inst = command.action.bind(newSession)(context, args)
        if (!(await newSession.inst.next()).done) {
            this.activeSessions.push(newSession)
        }
    },
    async callMiddleware(middleware, context) {
        const newSession = {
            history: [],
            inst: undefined
        }
        newSession.inst = middleware.action.bind(newSession)(context)
        if (!(await newSession.inst.next()).done) {
            this.activeSessions.push(newSession)
        }
    },
    async handleEvent(event) {
        logger.trace({
            msg: '收到事件',
            event: event,
        })

        console.log({
            msg: '当前 sessions : ',
            sessions: this.activeSessions
        })

        for (let i = this.activeSessions.length - 1; i >= 0; --i) {
            const session = this.activeSessions[i]
            // 目前触发方式只有一种
            if (event.post_type === 'message') {
                const replies = event.message.filter(msg => msg.type === 'reply').map(reply => reply.data.id)
                if (replies.some(id => !!id && session.history.includes(id))) {
                    if ((await session.inst.next(event)).done) {
                        this.activeSessions.splice(i, 1) // `session` 结束后删除 `session`
                    }
                }
            }
        }

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
                            await this.useAPI({
                                action: 'send_msg',
                                params: {
                                    detail_type: 'group',
                                    group_id: event.group_id,
                                    message: [
                                        { type: 'reply', data: { id: event.message_id } },
                                        { type: 'text', data: { text: `参数：${JSON.stringify(command.args, null, 4)}` } }
                                    ]
                                }
                            })
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
                    const errorLogPrefix = `为 profile "${profile.profile.name}" 载入插件 ${plugin.name} 失败：`

                    let pluginObject
                    try {
                        pluginObject = (await import(`./plugins/${plugin.name}/${plugin.name}.js`))[plugin.name]
                    } catch (err) {
                        const reason = `无法从 ./plugins/${plugin.name}/${plugin.name}.js 导入 ${plugin.name} 对象`
                        logger.error(errorLogPrefix + reason)
                        throw Error(reason, {
                            cause: err
                        })
                    }

                    // 检查插件能否正确载入

                    // 检查插件名称

                    if (!pluginObject.name) {
                        const reason = 'name 属性不存在'
                        logger.error(errorLogPrefix + reason)
                        throw Error(reason)
                    }

                    if (pluginObject.name !== plugin.name) {
                        const reason = `name 属性有误（${pluginObject.name}），应与插件名称相同`
                        logger.error(errorLogPrefix + reason)
                        throw Error(reason)
                    }

                    for (const usedName of profile.activePlugins.map(plugin => plugin.name)) {
                        if (usedName === plugin.name) {
                            const reason = '已经导入了同名插件'
                            logger.error(errorLogPrefix + reason)
                            throw Error(reason)
                        } else if (usedName.toLowerCase() === plugin.name.toLowerCase()) {
                            logger.warn(`插件 ${plugin.name} 与已加载的插件 ${usedName} 除大小写外完全相同`)
                        }
                    }

                    // 暂时没有对中间件的检查
                    // 检查命令是否能导入

                    if (!!pluginObject.command) {
                        const otherCommands = profile.activePlugins.flatMap(plugin => plugin.command).map(item => item.command)
                        const currentCommands = pluginObject.command.map(item => item.command)

                        let duplicateCommand = false
                        for (const i of currentCommands) {
                            if (otherCommands.includes(i)) {
                                duplicateCommand = true
                                logger.warn(`插件 ${plugin.name} 试图响应已有的命令 "${i}"`);
                            }
                            if (/\s/.test(i)) {
                                const reason = '命令不能带空格'
                                logger.error(`插件 ${plugin.name} 试图响应格式非法的命令 "${i}" ：` + reason)
                                throw Error(reason)
                            }
                        }

                        // 载入插件结束

                        if (duplicateCommand) {
                            const reason = '与已有插件响应了相同的命令'
                            logger.error(errorLogPrefix + reason)
                            throw Error(reason)
                        }
                    }
                    profile.activePlugins.push(pluginObject)
                } else {
                    const reason = `载入方式（${plugin?.load_method}）有误或暂不支持`
                    logger.warn(errorLogPrefix + reason)
                    throw Error(reason)
                }
            }
        } catch (err) {
            logger.error(`载入 profile "${profile.profile.name}" 失败`)
            throw Error(`载入 profile "${profile.profile.name}" 失败`, {
                cause: err
            })
        }
        this.activeProfiles.push(profile)
        logger.info(`已经载入 profile "${profile.profile.name}"`)
    },
    async dispatchResponse(response) {
        if (!this.responseWaitingList.includes(response.echo)) {
            logger.fatal(`收到的动作响应包含无效的 echo 字段：${response.echo}`)
            throw Error()
        }
        this.responseWaitingList.call(response.echo, response)
    },
    async useAPI(request) {
        if (!!request.echo) {
            logger.error({
                msg: '调用请求的 echo 字段未留空',
                request,
            })
            throw Error('调用请求的 echo 字段未留空')
        }
        logger.trace({
            msg: '调用了 API',
            request,
        })
        return new Promise((resolve, reject) => {
            const requestID = this.responseWaitingList.insert(resolve, reject)
            request.echo = requestID // 用于接收响应时判断是否为对应的事件
            ws.send(JSON.stringify(request), (err) => {
                if (err) {
                    logger.error({
                        msg: '调用 API 时发生错误',
                        err,
                        request,
                    })
                    reject(err)
                }
            })
            setTimeout(() => { reject(Error('timeout')) }, apiTimeout)
        })
    }
}

await bot.loadProfile('./profiles/test_group.json')