import { Socket } from 'socket.io-client'

export interface ClientMessage {
    timestamp: number
    message: string
    type: 'SEND' | 'RECEIVE'
}

export interface ClientPayload {
    id: string,
    name: string,
    event?: string,
    payload: string
}

export interface Client {
    id: string
    type?: 'Socket.IO'
    url: string
    payloads: ClientPayload[],
    currentPayloadId: string,
    event?: string
    message: string
    messages: ClientMessage[]
    ws: WebSocket | Socket | null
    visibility?: 'shown' | 'hidden'
}
