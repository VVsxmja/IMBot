import logger from '../../logger.js'
import { RemoveReplyFormat } from '../../message_format.js'

const maxAnswer = 8
const minAnswer = 1

const ParseGuess = (event) => {
    if (event.post_type === 'message') {
        const trimmed = event.raw_message.trim()
        if (trimmed.includes('.')) return
        const parsed = parseInt(trimmed)
        if (!isNaN(trimmed) && parsed) {
            return parsed
        }
    }
}

async function* GuessNumberGame(context) {
    let response = await context.bot.useAPI({
        action: 'send_msg',
        params: {
            detail_type: 'group',
            group_id: context.event.group_id,
            message: [
                { type: 'reply', data: { id: context.event.message_id } },
                { type: 'text', data: { text: `来猜一个 ${minAnswer} ~ ${maxAnswer} 之间的整数吧！` } },
            ]
        }
    })
    this.history.push(response.data.message_id.toString())
    const answer = Math.round(Math.random() * (maxAnswer - minAnswer) + minAnswer)
    logger.info(`用户在群组 ${context.event.group_id} 中开始进行猜数字游戏，答案为 ${answer}`)
    while (true) {
        const guessEvent = RemoveReplyFormat(yield)
        if (!ParseGuess(guessEvent)) {
            let response = await context.bot.useAPI({
                action: 'send_msg',
                params: {
                    detail_type: 'group',
                    group_id: guessEvent.group_id,
                    message: [
                        { type: 'reply', data: { id: guessEvent.message_id } },
                        { type: 'text', data: { text: '不是整数，再猜' } },
                        { type: 'face', data: { id: '11' } }
                    ]
                }
            })
            this.history.push(response.data.message_id.toString())
            continue
        }
        const guess = ParseGuess(guessEvent)
        if (guess === answer) {
            let response = await context.bot.useAPI({
                action: 'send_msg',
                params: {
                    detail_type: 'group',
                    group_id: guessEvent.group_id,
                    message: [
                        { type: 'reply', data: { id: guessEvent.message_id } },
                        { type: 'text', data: { text: '你猜对了，好强啊' } },
                        { type: 'face', data: { id: '111' } }
                    ]
                }
            })
            this.history.push(response.data.message_id.toString())
            break
        } else if (guess > answer) {
            let response = await context.bot.useAPI({
                action: 'send_msg',
                params: {
                    detail_type: 'group',
                    group_id: guessEvent.group_id,
                    message: [
                        { type: 'reply', data: { id: guessEvent.message_id } },
                        { type: 'text', data: { text: '太大了' } },
                        { type: 'face', data: { id: '26' } }
                    ]
                }
            })
            this.history.push(response.data.message_id.toString())
            continue
        } else if (guess < answer) {
            let response = await context.bot.useAPI({
                action: 'send_msg',
                params: {
                    detail_type: 'group',
                    group_id: guessEvent.group_id,
                    message: [
                        { type: 'reply', data: { id: guessEvent.message_id } },
                        { type: 'text', data: { text: '太小了' } },
                        { type: 'face', data: { id: '26' } }
                    ]
                }
            })
            this.history.push(response.data.message_id.toString())
            continue
        }
    }
}

export const guess_number = {
    name: 'guess_number',
    description: '一个猜数字的游戏，在给定范围内由用户猜测数字，机器人提示偏大或偏小，直到用户猜到正确答案',
    middleware: [
        {
            async match(context) {
                if (context.event.post_type === 'message') {
                    return context.event.raw_message.trim() === '猜数字游戏'
                }
                return false
            },
            pass: false,
            action: GuessNumberGame,
        }
    ],
    command: [
        {
            command: 'guess_number',
            action: GuessNumberGame
        }
    ]
}