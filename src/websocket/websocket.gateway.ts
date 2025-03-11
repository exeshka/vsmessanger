import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, WebSocket, Data } from 'ws';
import { WebsocketService } from './websocket.service';
import {
    MessageType,
    SocketMessage,
    MessageContentType,
    ImageMessageContent,
    ServerMessage,
    MessageContent,
    SearchEventContent
} from './interfaces/socket-message.interface';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { IncomingMessage } from 'http';

interface ExtendedMessageContent extends MessageContent {
    to?: string;
    chat_id?: string;
    page?: number;
    limit?: number;
    message_ids?: string[];
    message_id?: string | null;
    lastMessageId?: string | null;
    query?: string;
}

interface ExtendedSocketMessage {
    type: MessageType;
    id?: string;
    to?: string;
    content: ExtendedMessageContent;
}

@Injectable()
export class WebsocketGateway implements OnModuleInit, OnModuleDestroy {
    private wss: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly websocketService: WebsocketService,
        private readonly configService: ConfigService,
        private readonly prismaService: PrismaService
    ) { }

    onModuleInit() {
        try {
            const wsPort = this.configService.get('WS_PORT', 8080);
            this.wss = new WebSocket.Server({
                port: wsPort,
                path: '/ws'
            });

            console.log(`WebSocket server started on ws://localhost:${wsPort}/ws`);

            this.wss.on('connection', this.handleConnection.bind(this));
            this.wss.on('error', this.handleServerError.bind(this));
        } catch (error) {
            console.error('Failed to start WebSocket server:', error);
        }
    }

    async onModuleDestroy() {
        console.log('Closing WebSocket server...');
        if (this.wss) {
            // Закрываем все соединения
            this.wss.clients.forEach((client: WebSocket) => {
                try {
                    client.close();
                } catch (err) {
                    console.error('Error closing client connection:', err);
                }
            });

            // Закрываем сервер
            return new Promise<void>((resolve, reject) => {
                this.wss.close((err) => {
                    if (err) {
                        console.error('Error closing WebSocket server:', err);
                        reject(err);
                    } else {
                        console.log('WebSocket server closed successfully');
                        resolve();
                    }
                });
            });
        }
    }

    private async handleConnection(ws: WebSocket, request: IncomingMessage) {
        try {
            const { userId, username } = await this.authenticateConnection(request);
            const connectionId = await this.websocketService.addConnection(userId, ws);

            ws.on('message', (data: Data) => this.handleMessage(ws, data, userId, username));
            ws.on('close', () => this.handleDisconnect(userId, connectionId));

        } catch (error) {
            console.error('Connection error:', error);
            ws.close(1008, error.message || 'Connection failed');
        }
    }

    private async authenticateConnection(request: IncomingMessage): Promise<{ userId: string; username: string }> {
        if (!request.url) {
            throw new Error('Invalid connection request');
        }

        const url = new URL(request.url, `ws://localhost:8080`);
        const token = url.searchParams.get('token');

        if (!token) {
            throw new Error('Token not provided');
        }

        const secret = this.configService.get('JWT_SECRET');
        const payload = await this.jwtService.verify(token, { secret });
        const username = payload.username;

        const user = await this.prismaService.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true
            }
        });

        if (!user) {
            throw new Error('User not found');
        }

        return { userId: user.id, username: user.username };
    }

    private async handleMessage(ws: WebSocket, data: Data, userId: string, username: string) {
        try {
            console.log('Received message:', data.toString());

            let message: SocketMessage;
            try {
                message = JSON.parse(data.toString());
            } catch (parseError) {
                console.error('Failed to parse message:', parseError);
                console.error('Raw message:', data.toString());
                this.sendError(ws, 'Invalid JSON format. Message must be a valid JSON object');
                return;
            }

            if (!message.type) {
                console.error('Message type is missing:', message);
                this.sendError(ws, 'Message type is required');
                return;
            }

            message.type = message.type.trim().toLowerCase() as MessageType;
            console.log('Processing message:', { type: message.type, userId, username });

            switch (message.type) {
                case 'get_chats':
                    await this.websocketService.sendChatsList(username);
                    break;

                case 'get_users':
                    await this.websocketService.sendUsersList(userId);
                    break;

                case 'get_chat_detail':
                    const chatDetailContent = message as unknown as { content: { chat_id: string } };
                    if (!chatDetailContent.content.chat_id) {
                        this.sendError(ws, 'Chat ID is required');
                        return;
                    }
                    await this.websocketService.getChatDetail(userId, chatDetailContent.content.chat_id);
                    break;

                case 'get_user':
                    const getUserContent = message as unknown as { content: { user_id: string } };
                    if (!getUserContent.content.user_id) {
                        this.sendError(ws, 'User ID is required');
                        return;
                    }
                    await this.websocketService.sendUserInfo(userId, getUserContent.content.user_id);
                    break;

                case 'send_message':
                    const extendedMessage = message as unknown as ExtendedSocketMessage;
                    if (!extendedMessage.content.chat_id || !extendedMessage.content.text) {
                        this.sendError(ws, 'Chat ID and message text are required');
                        return;
                    }
                    await this.handleSendMessage(ws, message, userId);
                    break;

                case 'get_messages':
                    const getMsgContent = (message as unknown as ExtendedSocketMessage).content;
                    if (!getMsgContent.chat_id) {
                        this.sendError(ws, 'Chat ID is required');
                        return;
                    }
                    const chatId = getMsgContent.chat_id;
                    const lastMessageId = getMsgContent.lastMessageId || null;
                    const limit = getMsgContent.limit || 30;

                    // Проверяем валидность параметров
                    if (limit < 1 || limit > 100) {
                        this.sendError(ws, 'Invalid limit parameter');
                        return;
                    }

                    await this.websocketService.getChatMessages(chatId, userId, lastMessageId, limit, ws);
                    break;

                case 'update_messages_status':
                    const updateContent = (message as unknown as ExtendedSocketMessage).content;
                    if (!updateContent.chat_id || !updateContent.message_ids) {
                        this.sendError(ws, 'Chat ID and message IDs are required');
                        return;
                    }
                    const updateChatId = updateContent.chat_id;
                    const messageIds = updateContent.message_ids;

                    if (messageIds.length === 0) {
                        this.sendError(ws, 'No valid message IDs provided');
                        return;
                    }

                    await this.websocketService.updateMessagesStatus(updateChatId, userId, messageIds);
                    break;

                case 'search_event':
                    const searchContent = (message as unknown as ExtendedSocketMessage).content;
                    if (!searchContent.query) {
                        this.sendError(ws, 'Search query is required');
                        return;
                    }
                    await this.websocketService.searchByNickname(userId, searchContent.query);
                    break;

                default:
                    console.warn('Unknown message type:', message.type);
                    this.sendError(ws, 'Invalid message type');
            }
        } catch (error) {
            console.error('Message handling error:', error);
            console.error('Stack trace:', error.stack);
            this.sendError(ws, 'Invalid message format');
        }
    }

    private async handleSendMessage(ws: WebSocket, message: SocketMessage, userId: string) {
        console.log('Handling send message:', { message, userId });

        const extendedMessage = message as unknown as ExtendedSocketMessage;
        if (!extendedMessage.content.chat_id) {
            console.error('Missing chat ID:', message);
            this.sendError(ws, 'Chat ID is required');
            return;
        }

        try {
            const chatId = extendedMessage.content.chat_id;
            console.log('Sending to chat:', { fromUserId: userId, chatId });

            if (!extendedMessage.content.text) {
                console.error('Missing message content:', message);
                throw new Error('Message content is required');
            }

            const serverMessage: ServerMessage = {
                type: message.type,
                content: {
                    text: extendedMessage.content.text,
                    type: extendedMessage.content.type
                }
            };
            console.log('Prepared server message:', serverMessage);

            const response = await this.websocketService.sendToChat(userId, chatId, serverMessage);
            console.log('Message sent successfully:', response);
        } catch (error) {
            console.error('Error sending message:', error);
            console.error('Stack trace:', error.stack);
            this.sendError(ws, error.message || 'Failed to send message');
        }
    }

    private handleDisconnect(userId: string, connectionId: string) {
        this.websocketService.removeConnection(userId, connectionId);
    }

    private handleServerError(error: Error) {
        console.error('WebSocket server error:', error);
    }

    private sendError(ws: WebSocket, message: string) {
        ws.send(JSON.stringify({
            type: 'error',
            content: {
                message
            }
        }));
    }
}

