import logger from '../../logger.js'

async function respondGroupPing(group_id, bot) {
    logger.info(`在群组 ${group_id} 中被 ping 了`)
    try {
        await bot.useAPI({
            action: 'send_msg',
            params: {
                detail_type: 'group',
                group_id: group_id,
                message: [
                    { type: 'text', data: { text: '死了' } }
                ]
            }
        })
    } catch (err) {
        logger.error({
            msg: `在群组 ${group_id} 回复 ping 失败`,
            err,
        })
    }
}

export const ping = {
    name: 'ping',
    description: '测试机器人是否在线',
    middleware: [
        {
            async match(context) {
                if (context.event.post_type === 'message') {
                    return context.event.raw_message.trim() === '活着'
                }
                return false
            },
            pass: false,
            async *action(context) {
                await respondGroupPing(context.event.group_id, context.bot)
            },
        }
    ],
    command: [
        {
            command: 'ping',
            async *action(context) {
                await respondGroupPing(context.event.group_id, context.bot)
            }
        }
    ]
}