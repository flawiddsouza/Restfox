export interface ClientMessage {
    timestamp: number
    message: string
    type: 'SEND' | 'RECEIVE' | 'INFO'
}

export interface ClientPayload {
    id: string,
    name: string,
    event?: string,
    payload: string
}

export interface Client {
    id: string
    type?: 'Socket.IO-v2' | 'Socket.IO-v3' | 'Socket.IO'
    url: string
    payloads: ClientPayload[],
    currentPayloadId: string,
    event?: string
    message: string
    messages: ClientMessage[]
    visibility?: 'shown' | 'hidden'
}
