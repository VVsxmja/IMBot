// logger

import logger from './logger.js'
logger.info('程序已开始运行')
process.on('exit', () => {
    console.info('程序已退出')
})

import * as fs from 'fs/promises'
import * as path from 'path'
import { Mutex } from 'async-mutex'
import * as _MessageFormat from './message_format.js'
import { v4 as uuid } from 'uuid'
import { WebSocket } from 'ws'

const packageDir = path.dirname(import.meta.url)

export const MessageFormat = _MessageFormat
export const Logger = logger

export const bot = {
    activeProfiles: [],
    eventQueueLock: new Mutex(),
    activeSessions: [],
    apiTimeout: 3000,
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
        await this.eventQueueLock.runExclusive(async () => {
            try {
                await this.handleEvent(event)
            } catch (error) {
                logger.fatal({
                    msg: 'Unhandled error: ',
                    error,
                })
            }
        })
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
                    event: _MessageFormat.CloneEvent(event),
                    profile: profile,
                    bot: this
                }

                // 先判断事件是否满足命令形式

                try {
                    const command = _MessageFormat.ParseCommand(event)
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
    async loadProfile(profilePath) {
        logger.info(`正在从 ${profilePath} 载入 profile ……`)
        let content
        try {
            content = JSON.parse(await fs.readFile(profilePath, 'utf-8'))
        } catch (err) {
            logger.error(`无法从 ${profilePath} 载入 profile`)
            throw err
        }
        let profile = {
            profile: content,
            path: profilePath,
            activePlugins: [],
            loadPlugin(plugin) {
                // 检查插件能否正确载入

                // 检查插件名称

                if (!plugin.name) {
                    throw Error('name 属性不存在')
                }

                if (plugin.name !== plugin.name) {
                    throw Error(`name 属性有误（${plugin.name}），应与插件名称相同`)
                }

                for (const usedName of this.activePlugins.map(p => p.name)) {
                    if (usedName === plugin.name) {
                        throw Error('已经导入了同名插件')
                    } else if (usedName.toLowerCase() === plugin.name.toLowerCase()) {
                        logger.warn(`插件 ${plugin.name} 与已加载的插件 ${usedName} 除大小写外完全相同`)
                    }
                }

                // 暂时没有对中间件的检查
                // 检查命令是否能导入

                if (!!plugin.command) {
                    const otherCommands = this.activePlugins.flatMap(p => p?.command).map(i => i?.command).filter(Boolean)
                    const currentCommands = plugin.command.map(i => i?.command).filter(Boolean)

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
                        throw Error('与已有插件响应了相同的命令')
                    }
                }
                this.activePlugins.push(plugin)
            }
        }
        try {
            for (const plugin of profile.profile.plugins) {
                const errorLogPrefix = `为 profile "${profile.profile.name}" 载入插件 ${plugin.name} 失败：`

                if (plugin?.load_method === 'builtin') {
                    const target = path.join(packageDir, `plugins/${plugin.name}/${plugin.name}.js`)
                    try {
                        const pluginObject = (await import(target))[plugin.name]
                        profile.loadPlugin(pluginObject)
                    } catch (err) {
                        const reason = `无法从 ${target} 导入 ${plugin.name} 对象`
                        logger.error(errorLogPrefix + reason)
                        throw Error(reason, {
                            cause: err
                        })
                    }
                } else if (plugin?.load_method === 'import') {
                    const target = path.join(process.cwd(), `plugins/${plugin.name}/${plugin.name}.js`)
                    try {
                        const pluginObject = (await import(target))[plugin.name]
                        profile.loadPlugin(pluginObject)
                    } catch (err) {
                        const reason = `无法从 ${target} 导入 ${plugin.name} 对象`
                        logger.error(errorLogPrefix + reason)
                        throw Error(reason, {
                            cause: err
                        })
                    }
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
            this.ws.send(JSON.stringify(request), (err) => {
                if (err) {
                    logger.error({
                        msg: '调用 API 时发生错误',
                        err,
                        request,
                    })
                    reject(err)
                }
            })
            setTimeout(() => { reject(Error('timeout')) }, this.apiTimeout)
        })
    },
    async start() {
        if (!!this.ws) {
            logger.error('不可重复 start()')
        } else {
            return new Promise(async (resolve, reject) => {
                // 启动 go-cqhttp 服务
                try {
                    logger.info('正在等待 go-cqhttp 启动')
                    await (await import('./go-cqhttp/runner.js')).connect()
                    logger.info('go-cqhttp 已开始运行')
                } catch (err) {
                    logger.fatal({
                        msg: 'go-cqhttp 启动失败',
                        err,
                    })
                    reject()
                }
                // 正向 WebSocket 连接 go-cqhttp 服务器
                try {
                    this.ws = new WebSocket('ws://127.0.0.1:3050') // 端口号见 `config.yml`
                    this.ws.onopen = () => {
                        logger.info('程序已连接到 go-cqhttp 服务')
                        resolve()
                    }
                    this.ws.onclose = () => {
                        console.error('程序和 go-cqhttp 服务的连接已断开，程序即将退出')
                        process.exit(-1)
                    }
                    this.ws.onmessage = (message) => {
                        try {
                            const obj = JSON.parse(message.data)
                            if (Object.hasOwn(obj, 'echo')) {
                                // 该消息为动作响应
                                this.dispatchResponse(obj)
                            } else {
                                // 该消息为事件推送
                                this.pushEvent(obj)
                            }
                        } catch {
                            logger.warn(`收到非 JSON 格式消息，已忽略：${message.data}`)
                            return
                        }
                    }
                } catch (err) {
                    logger.fatal({
                        msg: '连接 go-cqhttp 服务失败',
                        err,
                    })
                    reject()
                }
            })
        }
    }
}