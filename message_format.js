export function TrimMessage(event) {
    if (event.post_type === 'message') {
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
        event = RemoveEmpty(event)
    } 
    return event
}

export function RemoveEmpty(event) {
    if (event.post_type === 'message') {
        event.message = event.message.filter(i => !(i.type === 'text' && i.data.text === ''))
    } 
    return event
}