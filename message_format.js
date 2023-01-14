// 所有的消息处理函数必须先将事件拷贝一份

export const CloneEvent = event => JSON.parse(JSON.stringify(event))

export function TrimMessage(event) {
    if (event.post_type !== 'message') return event
    event = CloneEvent(event)
    let modifiedMessage = []
    let foundFirstNonSpace = false
    for (const i of event.message) {
        if (!foundFirstNonSpace && i.type === 'text') {
            if (/^\s+$/.test(i.data.text)) {
                continue
            } else {
                foundFirstNonSpace = true
                i.data.text.replace(/^\s+/, '')
                modifiedMessage.push(i)
            }
        } else {
            modifiedMessage.push(i)
        }
    }
    const reversed = modifiedMessage.reverse()
    modifiedMessage = []
    let foundLastNonSpace = false
    for (const i of reversed) {
        if (!foundLastNonSpace && i.type === 'text') {
            if (/^\s+$/.test(i.data.text)) {
                continue
            } else {
                foundLastNonSpace = true
                i.data.text.replace(/\s+$/, '')
                modifiedMessage.push(i)
            }
        } else {
            modifiedMessage.push(i)
        }
    }
    event.message = modifiedMessage.reverse()
    return RemoveEmpty(event)
}

export function RemoveEmpty(event) {
    if (event.post_type !== 'message') return event
    event = CloneEvent(event)
    event.message = event.message.filter(i => !(i.type === 'text' && i.data.text === ''))
    return event
}

// TODO: ExtractDirectMessage()

export function ParseCommand(event) {
    if (event.post_type !== 'message') return undefined
    event = TrimMessage(event)
    // TODO: 检查是否是直接消息
    if (event.message.length <= 0 || event.message[0].type !== 'text') return undefined // 不以文本开头
    const commandMatcher = /\/(?<command>[^\s]+)/
    const matchResult = commandMatcher.exec(event.message[0].data.text)
    if (!matchResult) return undefined
    const command = matchResult.groups.command
    event.message[0].data.text = event.message[0].data.text.replace(commandMatcher, '')
    event = TrimMessage(event)

    // 解析参数

    const ArgTypes = ['text', 'at', 'face'] // 参数支持的类型
    const quoteCharset = ['\"', '\'']
    let args = []
    let thisArg = []
    class State {
        constructor(type) {
            if (!['normal', 'inQuote', 'nothing'].includes(type)) throw Error()
            this.type = type
            switch (this.type) {
                case 'inQuote':
                    if (!quoteCharset.includes(arguments[1])) throw Error()
                    this.quote = arguments[1]
                    break
                case 'nothing':
                    break
                case 'normal':
                    break
            }
        }
    }
    let state = new State('nothing')
    for (const msg of event.message) {
        if (!ArgTypes.includes(msg.type)) {
            logger.warn({
                msg: `在解析参数时忽略了类型为 ${msg.type} 的消息`,
                event,
            })
            continue
        }
        if (msg.type !== 'text') {
            // 其他类型的内容
            switch (state.type) {
                case 'nothing':
                    state = new State('normal') // fallthrough
                case 'inQuote': // fallthrough
                case 'normal':
                    thisArg.push(msg)
                    break
            }
        } else {
            const NewText = () => {
                return {
                    type: 'text',
                    data: {
                        text: ''
                    },
                }
            }
            let thisText = NewText()
            for (const ch of msg.data.text) {
                switch (state.type) {
                    case 'nothing':
                        if (quoteCharset.includes(ch)) {
                            // 引号，第一次出现
                            state = new State('inQuote', ch)
                        } else if (/^\s$/.test(ch)) {
                            // 分隔符
                            // 什么也不做
                        } else {
                            // 普通字符
                            thisText.data.text += ch
                            state = new State('normal')
                        }
                        break
                    case 'normal':
                        if (quoteCharset.includes(ch)) {
                            // 第一次出现某种引号
                            state = new State('inQuote', ch)
                        } else if (/^\s$/.test(ch)) {
                            // 分隔符
                            // 保存当前参数
                            if (thisText.data.text) {
                                thisArg.push(thisText)
                                thisText = NewText() // reset
                            }
                            if (thisArg.length) {
                                args.push(thisArg)
                                thisArg = []
                            }
                            state = new State('nothing')
                        } else {
                            thisText.data.text += ch
                        }
                        break
                    case 'inQuote':
                        if (quoteCharset.includes(ch) && state.quote === ch) {
                            // 同种引号第二次出现，引号结束
                            state = new State('normal')
                        } else {
                            // 其他所有字符
                            thisText.data.text += ch
                        }
                        break
                }
            }
            // 处理最后一段文本（被留在 thisText 中）
            if (thisText.data.text) {
                switch (state.type) {
                    case 'nothing':
                        break
                    case 'inQuote': // fallthrough
                    case 'normal':
                        thisArg.push(thisText)
                        break
                }
            }
        }
    }
    // 处理最后一个参数（此时被留在 thisArg 中）
    switch (state.type) {
        case 'inQuote':
            throw Error('引号不匹配')
        case 'nothing':
            break
        case 'normal':
            if (thisArg.length) {
                args.push(thisArg)
                thisArg = []
            }
            break
    }
    return {
        command,
        args,
    }
}

