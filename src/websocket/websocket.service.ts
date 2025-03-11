import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import {
    SocketMessage,
    MessageType,
    UserInfo,
    SendMessageType,
    MessageState,
    ChatType,
    ServiceMessageType,
    ImageMessageContent,
    MessageContentType,
    ReceiveMessageType,
    ServerResponse,
    MessageContent,
    ErrorContent,
    ChatListContent,
    UsersListContent,
    MessageData,
    SystemMessageData,
    ChatWithMessages,
    ServerMessage,
    ChatListItem,
    StateResponse,
    MessagesListContent,
    MessageStatus,
    SearchEventResponse,
    ChatDetailResponse
} from './interfaces/socket-message.interface';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface Connection {
    ws: WebSocket;
    connectionId: string;
}

@Injectable()
export class WebsocketService {
    private connections: Map<string, Connection[]> = new Map();
    private messageStates: Map<string, { type: MessageType; timestamp: number; sender: string }> = new Map();
    private clients: Map<string, WebSocket> = new Map();

    constructor(private readonly prisma: PrismaService) { }

    async addConnection(userId: string, ws: WebSocket) {
        const connectionId = uuidv4();
        const newConnection: Connection = { ws, connectionId };

        if (!this.connections.has(userId)) {
            this.connections.set(userId, []);
        }

        this.connections.get(userId)?.push(newConnection);
        this.clients.set(userId, ws);

        // Обновляем статус онлайн
        await this.updateUserOnlineStatus(userId);

        // Логируем текущие подключения
        console.log('Active connections:', {
            totalUsers: this.connections.size,
            connectedUsers: Array.from(this.connections.keys()),
            userConnections: Object.fromEntries(
                Array.from(this.connections.entries()).map(([id, conns]) => [id, conns.length])
            )
        });

        return connectionId;
    }

    removeConnection(userId: string, connectionId: string) {
        const userConnections = this.connections.get(userId);
        if (userConnections) {
            const filteredConnections = userConnections.filter(conn => conn.connectionId !== connectionId);
            if (filteredConnections.length === 0) {
                this.connections.delete(userId);
                this.clients.delete(userId);
                // Обновляем статус оффлайн только если у пользователя не осталось активных соединений
                this.updateUserOfflineStatus(userId);
            } else {
                this.connections.set(userId, filteredConnections);
            }
        }

        // Логируем оставшиеся подключения после отключения
        console.log('Remaining connections after disconnect:', {
            totalUsers: this.connections.size,
            connectedUsers: Array.from(this.connections.keys()),
            userConnections: Object.fromEntries(
                Array.from(this.connections.entries()).map(([id, conns]) => [id, conns.length])
            )
        });
    }

    getConnections(userId: string): Connection[] {
        return this.connections.get(userId) || [];
    }

    getAllConnections(): Map<string, Connection[]> {
        return this.connections;
    }

    async findOrCreateChat(userId1: string, userId2: string) {
        // Сортируем ID пользователей, чтобы меньший был первым
        const [smallerId, largerId] = [userId1, userId2].sort();
        const chatId = `${smallerId}-${largerId}`;

        const existingChat = await this.prisma.chat.findUnique({
            where: {
                id: chatId
            },
            include: {
                members: true,
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        sender: true
                    }
                }
            }
        });

        if (existingChat) {
            return existingChat;
        }

        return this.prisma.chat.create({
            data: {
                id: chatId,
                type: ChatType.DIRECT,
                members: {
                    connect: [
                        { id: userId1 },
                        { id: userId2 }
                    ]
                }
            },
            include: {
                members: true,
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        sender: true
                    }
                }
            }
        });
    }

    async saveMessage({ content, contentType, chatId, senderId }: {
        content: string | ImageMessageContent,
        contentType: MessageContentType,
        chatId: string,
        senderId: string
    }) {
        const messageContent = typeof content === 'string' ? content : JSON.stringify(content);
        const prismaContentType = contentType === MessageContentType.TEXT ? 'TEXT' : 'IMAGE';

        return this.prisma.message.create({
            data: {
                content: messageContent,
                contentType: prismaContentType,
                status: 'SENT',
                chat: { connect: { id: chatId } },
                sender: { connect: { id: senderId } }
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        username: true,
                        createdAt: true,
                        updatedAt: true,
                        images: true
                    }
                }
            }
        });
    }

    private createMessageData(message: any): MessageData {
        return {
            chat_id: message.chatId,
            message_id: message.id,
            text: message.content,
            type: message.contentType as MessageContentType,
            status: message.status as MessageStatus,
            from: {
                id: message.sender.id,
                username: message.sender.username,
                createdAt: message.sender.createdAt,
                updatedAt: message.sender.updatedAt,
                is_online: message.sender.is_online || false,
                last_online: message.sender.last_online || message.sender.updatedAt,
                images: message.sender.images
            },
            timestamp: message.createdAt.toISOString()
        };
    }

    private createMessage(
        type: MessageType,
        messageData: MessageData
    ): ServerResponse<MessageData> {
        if (!messageData.from) {
            throw new Error('From field is required for message');
        }

        return {
            type,
            content: messageData
        };
    }

    private createSystemMessage(
        type: MessageType,
        data: SystemMessageData
    ): ServerResponse<MessageData> {
        const systemUser: UserInfo = {
            id: '0',
            username: 'System',
            createdAt: new Date(),
            updatedAt: new Date(),
            is_online: true,
            last_online: new Date(),
            images: []
        };

        return {
            type,
            content: {
                chat_id: '0',
                message_id: '0',
                text: data.text,
                type: data.messageType,
                status: MessageStatus.SENT,
                from: data.from || systemUser,
                timestamp: new Date().toISOString()
            }
        };
    }

    createErrorMessage(type: ServiceMessageType, message: string): ServerResponse<ErrorContent> {
        return {
            type,
            content: {
                message
            }
        };
    }

    private getMessageState(baseType: SendMessageType, state: MessageState): MessageType {
        return `${baseType}_${state}` as MessageType;
    }

    private async getUserInfo(userId: string): Promise<UserInfo | null> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                createdAt: true,
                updatedAt: true,
                is_online: true,
                last_online: true,
                images: true
            }
        });

        return user;
    }

    private updateMessageState(messageId: string, type: MessageType, senderId: string, error?: string) {
        const state = this.messageStates.get(messageId);
        if (state) {
            state.type = type;
            this.messageStates.set(messageId, state);

            const connections = this.getConnections(senderId);
            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        id: messageId,
                        type,
                        error,
                        timestamp: Date.now()
                    }));
                }
            });
        }
    }

    private notifyMessageState(userId: string, message: SocketMessage) {
        const connections = this.getConnections(userId);
        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }

    async sendToUser(fromUserId: string, toUserId: string, message: ServerMessage) {
        const requestId = uuidv4();
        const senderConnections = this.getConnections(fromUserId);

        // Отправляем состояние загрузки отправителю
        const loadingMessage: StateResponse<'send_message'> = {
            type: 'send_message_loading',
            content: { requestId }
        };

        senderConnections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(loadingMessage));
            }
        });

        try {
            console.log('Attempting to send message:', {
                fromUserId,
                toUserId,
                activeConnections: {
                    totalUsers: this.connections.size,
                    connectedUsers: Array.from(this.connections.keys()),
                    recipientConnected: this.connections.has(toUserId),
                    senderConnected: this.connections.has(fromUserId)
                }
            });

            const chat = await this.findOrCreateChat(fromUserId, toUserId);

            const savedMessage = await this.saveMessage({
                content: message.content.text,
                contentType: message.content.type,
                chatId: chat.id,
                senderId: fromUserId
            });

            const messageData = this.createMessageData(savedMessage);

            // Создаем разные ответы для отправителя и получателя
            const successMessage: StateResponse<'send_message'> = {
                type: 'send_message_success',
                content: messageData
            };

            const receiveMessage: ServerResponse<MessageData> = {
                type: 'receive_message',
                content: messageData
            };

            // Отправляем сообщение получателю
            const recipientWs = this.clients.get(toUserId);
            if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                console.log('Sending message to recipient websocket');
                recipientWs.send(JSON.stringify(receiveMessage));

                // Обновляем список чатов у получателя без состояния загрузки
                const recipientUser = await this.prisma.user.findUnique({
                    where: { id: toUserId },
                    select: { username: true }
                });
                if (recipientUser) {
                    await this.sendChatsListDirect(recipientUser.username);
                }
            } else {
                console.log('Recipient websocket not found or not open:', {
                    userId: toUserId,
                    hasWebSocket: !!recipientWs,
                    readyState: recipientWs ? recipientWs.readyState : 'no websocket'
                });
            }

            // Отправляем подтверждение отправителю
            const senderWs = this.clients.get(fromUserId);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                console.log('Sending success message to sender websocket');
                senderWs.send(JSON.stringify(successMessage));

                // Обновляем список чатов у отправителя без состояния загрузки
                const senderUser = await this.prisma.user.findUnique({
                    where: { id: fromUserId },
                    select: { username: true }
                });
                if (senderUser) {
                    await this.sendChatsListDirect(senderUser.username);
                }
            } else {
                console.log('Sender websocket not found or not open:', {
                    userId: fromUserId,
                    hasWebSocket: !!senderWs,
                    readyState: senderWs ? senderWs.readyState : 'no websocket'
                });
            }

            return successMessage;
        } catch (error) {
            console.error('Error sending message:', error);

            // Отправляем сообщение об ошибке отправителю
            const errorMessage: StateResponse<'send_message'> = {
                type: 'send_message_error',
                content: {
                    requestId,
                    message: 'Failed to send message'
                }
            };

            senderConnections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });

            throw error;
        }
    }

    private async sendMessageWithState(ws: WebSocket, message: SocketMessage & { id: string }, senderId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const errorType = this.getMessageState('send_message', 'error');
                this.updateMessageState(message.id, errorType, senderId, 'Message timeout');
                reject(new Error('Message timeout'));
            }, 5000);

            try {
                this.messageStates.set(message.id, {
                    type: this.getMessageState('send_message', 'loading'),
                    timestamp: Date.now(),
                    sender: senderId
                });

                this.notifyMessageState(senderId, {
                    ...message,
                    type: this.getMessageState('send_message', 'loading')
                });

                ws.send(JSON.stringify(message), (error) => {
                    clearTimeout(timeout);

                    if (error) {
                        const errorType = this.getMessageState('send_message', 'error');
                        this.updateMessageState(message.id, errorType, senderId, error.message);
                        reject(error);
                    } else {
                        const successType = this.getMessageState('send_message', 'success');
                        this.updateMessageState(message.id, successType, senderId);
                        resolve();
                    }
                });
            } catch (error) {
                clearTimeout(timeout);
                const errorType = this.getMessageState('send_message', 'error');
                this.updateMessageState(message.id, errorType, senderId, error.message);
                reject(error);
            }
        });
    }

    async broadcast(message: ServerMessage, senderId: string) {
        try {
            const sender = await this.getUserInfo(senderId);

            if (!sender) {
                throw new Error('Sender not found');
            }

            const messageText = typeof message.content.text === 'string'
                ? message.content.text
                : message.content.text.caption || 'Sent an image';

            const promises = Array.from(this.connections.entries())
                .filter(([userId]) => userId !== senderId)
                .flatMap(([, connections]) =>
                    connections.map(async ({ ws }) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            const systemMessage = this.createSystemMessage(
                                'system',
                                {
                                    text: messageText,
                                    messageType: MessageContentType.TEXT,
                                    from: sender
                                }
                            );

                            try {
                                ws.send(JSON.stringify(systemMessage));
                            } catch (error) {
                                console.error('Error broadcasting message:', error);
                            }
                        }
                    })
                );

            await Promise.all(promises);
        } catch (error) {
            console.error('Error processing broadcast message:', error);
            throw error;
        }
    }

    sendSystemMessage(userId: string, content: string) {
        const connections = this.getConnections(userId);
        const message = this.createSystemMessage('system', {
            text: content,
            messageType: MessageContentType.TEXT
        });

        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }

    broadcastSystemMessage(content: string) {
        const message = this.createSystemMessage('system', {
            text: content,
            messageType: MessageContentType.TEXT
        });

        this.connections.forEach(connections => {
            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            });
        });
    }

    async getChatHistory(chatId: string, limit: number = 50) {
        return await this.prisma.message.findMany({
            where: {
                chatId
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        username: true,
                        createdAt: true,
                        updatedAt: true,
                        images: true,
                        chats: {
                            select: {
                                id: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });
    }

    async getUserChats(username: string): Promise<ChatWithMessages[]> {
        const user = await this.prisma.user.findUnique({
            where: { username },
            include: {
                chats: {
                    include: {
                        members: {
                            select: {
                                id: true,
                                username: true,
                                createdAt: true,
                                updatedAt: true,
                                is_online: true,
                                last_online: true,
                                images: true
                            }
                        },
                        messages: {
                            orderBy: {
                                createdAt: 'desc'
                            },
                            take: 1,
                            select: {
                                id: true,
                                content: true,
                                contentType: true,
                                status: true,
                                createdAt: true,
                                sender: {
                                    select: {
                                        id: true,
                                        username: true,
                                        createdAt: true,
                                        updatedAt: true,
                                        is_online: true,
                                        last_online: true,
                                        images: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!user) {
            throw new Error('User not found');
        }

        return user.chats
            .map(chat => ({
                id: chat.id,
                type: ChatType.DIRECT,
                members: chat.members.map(member => ({
                    id: member.id,
                    username: member.username,
                    createdAt: member.createdAt,
                    updatedAt: member.updatedAt,
                    is_online: member.is_online,
                    last_online: member.last_online,
                    images: member.images
                })),
                messages: chat.messages.map(msg => ({
                    id: msg.id,
                    content: msg.content,
                    contentType: msg.contentType === 'TEXT' ? MessageContentType.TEXT : MessageContentType.IMAGE,
                    status: msg.status,
                    createdAt: msg.createdAt,
                    sender: {
                        id: msg.sender.id,
                        username: msg.sender.username,
                        createdAt: msg.sender.createdAt,
                        updatedAt: msg.sender.updatedAt,
                        is_online: msg.sender.is_online,
                        last_online: msg.sender.last_online,
                        images: msg.sender.images
                    }
                })),
                name: this.getDirectChatName(chat.members, username),
                lastMessageDate: chat.messages[0]?.createdAt || new Date(0)
            }))
            .sort((a, b) => b.lastMessageDate.getTime() - a.lastMessageDate.getTime());
    }

    private getDirectChatName(members: { username: string }[], currentUsername: string): string {
        const otherMember = members.find(member => member.username !== currentUsername);
        return otherMember ? otherMember.username : 'Unknown User';
    }

    async getUsersList(): Promise<UserInfo[]> {
        return await this.prisma.user.findMany({
            select: {
                id: true,
                username: true,
                createdAt: true,
                updatedAt: true,
                is_online: true,
                last_online: true,
                images: true
            }
        });
    }

    async sendUsersList(userId: string) {
        const requestId = uuidv4();
        const connections = this.getConnections(userId);

        // Отправляем состояние загрузки
        const loadingMessage: StateResponse<'get_users'> = {
            type: 'get_users_loading',
            content: { requestId }
        };

        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(loadingMessage));
            }
        });

        try {
            const users = await this.getUsersList();

            // Отправляем успешный результат
            const successMessage: ServerResponse<UsersListContent> = {
                type: 'get_users_success',
                content: { users }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(successMessage));
                }
            });
        } catch (error) {
            console.error('Error sending users list:', error);

            // Отправляем сообщение об ошибке
            const errorMessage: StateResponse<'get_users'> = {
                type: 'get_users_error',
                content: {
                    requestId,
                    message: 'Failed to get users list'
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });
        }
    }

    private createLastMessageData(message: any): MessageData | null {
        if (!message) return null;
        return {
            chat_id: message.chatId,
            message_id: message.id,
            text: message.content,
            type: message.contentType as MessageContentType,
            status: message.status as MessageStatus,
            from: {
                id: message.sender.id,
                username: message.sender.username,
                createdAt: message.sender.createdAt,
                updatedAt: message.sender.updatedAt,
                is_online: message.sender.is_online || false,
                last_online: message.sender.last_online || message.sender.updatedAt,
                images: message.sender.images
            },
            timestamp: message.createdAt.toISOString()
        };
    }

    async sendChatsList(username: string): Promise<void> {
        const user = await this.prisma.user.findUnique({
            where: { username },
            select: { id: true }
        });

        if (!user) {
            throw new Error('User not found');
        }

        const requestId = uuidv4();
        const connections = this.getConnections(user.id.toString());

        // Отправляем состояние загрузки
        const loadingMessage: StateResponse<'get_chats'> = {
            type: 'get_chats_loading',
            content: { requestId }
        };

        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(loadingMessage));
            }
        });

        try {
            const chats = await this.getUserChats(username);

            // Отправляем успешный результат
            const successMessage: ServerResponse<ChatListContent> = {
                type: 'get_chats_success',
                content: {
                    chats: chats.map(chat => {
                        const lastMessage = chat.messages[0];
                        return {
                            id: chat.id,
                            type: chat.type,
                            members: chat.members,
                            last_message: this.createLastMessageData(lastMessage),
                            name: chat.name
                        };
                    })
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(successMessage));
                }
            });
        } catch (error) {
            console.error('Error sending chats list:', error);

            // Отправляем сообщение об ошибке
            const errorMessage: StateResponse<'get_chats'> = {
                type: 'get_chats_error',
                content: {
                    requestId,
                    message: 'Failed to get chats list'
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });
        }
    }

    private async sendChatsListDirect(username: string): Promise<void> {
        const user = await this.prisma.user.findUnique({
            where: { username },
            select: { id: true }
        });

        if (!user) {
            return;
        }

        try {
            const chats = await this.getUserChats(username);
            const successMessage: ServerResponse<ChatListContent> = {
                type: 'get_chats_success',
                content: {
                    chats: chats.map(chat => {
                        const lastMessage = chat.messages[0];
                        return {
                            id: chat.id,
                            type: chat.type,
                            members: chat.members,
                            last_message: this.createLastMessageData(lastMessage),
                            name: chat.name
                        };
                    })
                }
            };

            const connections = this.getConnections(user.id.toString());
            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(successMessage));
                }
            });
        } catch (error) {
            console.error('Error sending direct chats list:', error);
        }
    }

    async getChatMessages(chatId: string, userId: string, lastMessageId: string | null = null, limit: number = 30, ws: WebSocket): Promise<void> {
        try {
            console.log('Received request with params:', {
                chatId,
                userId,
                lastMessageId,
                limit
            });

            // Проверяем, есть ли у пользователя доступ к чату
            const chat = await this.prisma.chat.findFirst({
                where: {
                    id: chatId,
                    members: {
                        some: {
                            id: userId
                        }
                    }
                }
            });

            if (!chat) {
                const emptyResponse: ServerResponse<MessagesListContent> = {
                    type: 'get_messages_success',
                    content: {
                        messages: [],
                        pagination: {
                            lastMessageId: null,
                            limit,
                            hasMore: false
                        }
                    }
                };
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(emptyResponse));
                }
                return;
            }

            // Строим базовый запрос с условием для чата
            const baseQuery: Prisma.MessageWhereInput = {
                chatId: chat.id
            };

            // Если есть lastMessageId, добавляем условие для получения более старых сообщений
            if (lastMessageId) {
                Object.assign(baseQuery, {
                    id: {
                        lt: lastMessageId
                    }
                });
            }

            console.log('Executing query with conditions:', JSON.stringify(baseQuery, null, 2));

            const messages = await this.prisma.message.findMany({
                where: baseQuery,
                include: {
                    sender: {
                        select: {
                            id: true,
                            username: true,
                            createdAt: true,
                            updatedAt: true,
                            is_online: true,
                            last_online: true,
                            images: true
                        }
                    }
                },
                orderBy: {
                    id: Prisma.SortOrder.desc
                },
                take: limit + 1
            });

            console.log('Query result:', {
                totalMessages: messages.length,
                firstMessageId: messages[0]?.id,
                lastMessageId: messages[messages.length - 1]?.id,
                messageIds: messages.map(m => m.id)
            });

            const hasMore = messages.length > limit;
            const messagesToSend = messages.slice(0, limit);
            const messagesList = messagesToSend.map(message => this.createMessageData(message));

            const successMessage: ServerResponse<MessagesListContent> = {
                type: 'get_messages_success',
                content: {
                    messages: messagesList,
                    pagination: {
                        lastMessageId: messagesToSend[messagesToSend.length - 1]?.id || null,
                        limit,
                        hasMore
                    }
                }
            };

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(successMessage));
            }
        } catch (error) {
            console.error('Error getting chat messages:', error);
            const errorResponse: ServerResponse<MessagesListContent> = {
                type: 'get_messages_success',
                content: {
                    messages: [],
                    pagination: {
                        lastMessageId: null,
                        limit,
                        hasMore: false
                    }
                }
            };
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(errorResponse));
            }
        }
    }

    async updateMessagesStatus(chatId: string, userId: string, messageIds: string[]): Promise<void> {
        const connections = this.getConnections(userId);
        const requestId = uuidv4();

        try {
            // Проверяем доступ к чату
            const chat = await this.prisma.chat.findFirst({
                where: {
                    id: chatId,
                    members: {
                        some: {
                            id: userId
                        }
                    }
                }
            });

            if (!chat) {
                throw new Error('Chat not found or access denied');
            }

            // Проверяем, что сообщения не принадлежат текущему пользователю
            const messages = await this.prisma.message.findMany({
                where: {
                    id: {
                        in: messageIds
                    },
                    chatId: chatId
                },
                select: {
                    id: true,
                    senderId: true
                }
            });

            const ownMessages = messages.filter(msg => msg.senderId === userId);
            if (ownMessages.length > 0) {
                throw new Error('Cannot mark your own messages as read');
            }

            // Обновляем статус сообщений
            await this.prisma.message.updateMany({
                where: {
                    id: {
                        in: messageIds
                    },
                    chatId: chatId,
                    NOT: {
                        senderId: userId
                    }
                },
                data: {
                    status: 'READ'
                }
            });

            // Получаем обновленные сообщения
            const updatedMessages = await this.prisma.message.findMany({
                where: {
                    id: {
                        in: messageIds
                    }
                },
                include: {
                    sender: {
                        select: {
                            id: true,
                            username: true,
                            createdAt: true,
                            updatedAt: true,
                            images: true
                        }
                    }
                }
            });

            // Отправляем уведомление об обновлении статуса отправителям сообщений
            const messagesBySender = new Map<string, MessageData[]>();

            updatedMessages.forEach(message => {
                const messageData = this.createMessageData(message);

                if (!messagesBySender.has(message.senderId)) {
                    messagesBySender.set(message.senderId, []);
                }
                messagesBySender.get(message.senderId)?.push(messageData);
            });

            // Отправляем уведомления каждому отправителю
            for (const [senderId, messages] of messagesBySender) {
                const senderConnections = this.getConnections(senderId);
                const statusUpdate: ServerResponse<{ messages: MessageData[] }> = {
                    type: 'messages_status_updated',
                    content: { messages }
                };

                senderConnections.forEach(({ ws }) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(statusUpdate));
                    }
                });
            }

        } catch (error) {
            console.error('Error updating messages status:', error);

            const errorMessage: StateResponse<'update_messages_status'> = {
                type: 'update_messages_status_error',
                content: {
                    requestId,
                    message: error.message || 'Failed to update messages status'
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });
        }
    }

    async sendToChat(senderId: string, chatId: string, message: ServerMessage) {
        try {
            // Проверяем, существует ли чат и имеет ли пользователь к нему доступ
            let chat = await this.prisma.chat.findUnique({
                where: { id: chatId },
                include: {
                    members: true
                }
            });

            // Если чат не существует, создаем его
            if (!chat) {
                // Извлекаем ID второго участника из chatId (предполагая формат: userId1-userId2)
                const [id1, id2] = chatId.split('-');
                if (!id1 || !id2) {
                    throw new Error('Invalid chat ID format');
                }

                // Сортируем ID пользователей, чтобы меньший был первым
                const [smallerId, largerId] = [id1, id2].sort();
                const sortedChatId = `${smallerId}-${largerId}`;

                // Проверяем, не существует ли уже чат с отсортированным ID
                if (sortedChatId !== chatId) {
                    chat = await this.prisma.chat.findUnique({
                        where: { id: sortedChatId },
                        include: {
                            members: true
                        }
                    });
                }

                // Если чат все еще не существует, создаем новый
                if (!chat) {
                    chat = await this.prisma.chat.create({
                        data: {
                            id: sortedChatId,
                            type: ChatType.DIRECT,
                            members: {
                                connect: [
                                    { id: id1 },
                                    { id: id2 }
                                ]
                            }
                        },
                        include: {
                            members: true
                        }
                    });
                }
            }

            // Проверяем, является ли отправитель участником чата
            if (!chat.members.some(member => member.id === senderId)) {
                throw new Error('You are not a member of this chat');
            }

            // Сохраняем сообщение в базе данных
            const savedMessage = await this.saveMessage({
                content: message.content.text,
                contentType: message.content.type || MessageContentType.TEXT,
                chatId: chat.id,
                senderId: senderId
            });

            // Создаем объект сообщения для отправки
            const messageData = this.createMessageData(savedMessage);
            const serverMessage = this.createMessage('receive_message' as MessageType, messageData);

            // Отправляем сообщение всем участникам чата
            for (const member of chat.members) {
                if (member.id !== senderId) { // Не отправляем сообщение отправителю
                    const connections = this.getConnections(member.id);
                    for (const connection of connections) {
                        connection.ws.send(JSON.stringify(serverMessage));
                    }
                }
            }

            // Отправляем подтверждение отправителю
            const confirmationMessage = this.createMessage('send_message_success' as MessageType, messageData);
            const senderConnections = this.getConnections(senderId);
            for (const connection of senderConnections) {
                connection.ws.send(JSON.stringify(confirmationMessage));
            }

            // Обновляем список чатов для всех участников
            for (const member of chat.members) {
                await this.sendChatsList(member.username);
            }

            return messageData;
        } catch (error) {
            console.error('Error sending message to chat:', error);
            throw error;
        }
    }

    async searchByNickname(userId: string, query: string) {
        const requestId = uuidv4();
        const connections = this.getConnections(userId);

        // Отправляем состояние загрузки
        const loadingMessage: StateResponse<'search_event'> = {
            type: 'search_event_loading',
            content: { requestId }
        };

        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(loadingMessage));
            }
        });

        try {
            // Ищем пользователей по частичному совпадению никнейма
            const users = await this.prisma.user.findMany({
                where: {
                    username: {
                        contains: query
                    }
                },
                select: {
                    id: true,
                    username: true,
                    createdAt: true,
                    updatedAt: true,
                    is_online: true,
                    last_online: true,
                    images: true
                }
            });

            // Отправляем успешный результат
            const successMessage: ServerResponse<SearchEventResponse> = {
                type: 'search_event_success',
                content: { users }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(successMessage));
                }
            });

            return users;
        } catch (error) {
            console.error('Error searching users:', error);

            // Отправляем сообщение об ошибке
            const errorMessage: StateResponse<'search_event'> = {
                type: 'search_event_error',
                content: {
                    requestId,
                    message: 'Failed to search users'
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });

            throw error;
        }
    }

    async sendUserInfo(requesterId: string, targetUserId: string) {
        const requestId = uuidv4();
        const connections = this.getConnections(requesterId);

        // Отправляем состояние загрузки
        const loadingMessage: StateResponse<'get_user'> = {
            type: 'get_user_loading',
            content: { requestId }
        };

        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(loadingMessage));
            }
        });

        try {
            const user = await this.prisma.user.findUnique({
                where: { id: targetUserId },
                select: {
                    id: true,
                    username: true,
                    createdAt: true,
                    updatedAt: true,
                    is_online: true,
                    last_online: true,
                    images: true
                }
            });

            if (!user) {
                throw new Error('User not found');
            }

            // Отправляем успешный результат
            const successMessage: ServerResponse<{ user: UserInfo }> = {
                type: 'get_user_success',
                content: { user }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(successMessage));
                }
            });

            return user;
        } catch (error) {
            console.error('Error getting user info:', error);

            // Отправляем сообщение об ошибке
            const errorMessage: StateResponse<'get_user'> = {
                type: 'get_user_error',
                content: {
                    requestId,
                    message: error.message || 'Failed to get user info'
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });

            throw error;
        }
    }

    async getChatDetail(userId: string, chatId: string) {
        const requestId = uuidv4();
        const connections = this.getConnections(userId);

        // Отправляем состояние загрузки
        const loadingMessage: StateResponse<'get_chat_detail'> = {
            type: 'get_chat_detail_loading',
            content: { requestId }
        };

        connections.forEach(({ ws }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(loadingMessage));
            }
        });

        try {
            // Проверяем формат chatId
            if (!chatId.includes('-')) {
                throw new Error('Invalid chat ID format');
            }

            // Разбиваем chatId на ID пользователей
            const [id1, id2] = chatId.split('-');
            if (!id1 || !id2) {
                throw new Error('Invalid chat ID format');
            }

            // Находим ID другого пользователя
            const otherUserId = id1 === userId ? id2 : id1;

            // Проверяем существование другого пользователя
            const otherUser = await this.prisma.user.findUnique({
                where: { id: otherUserId },
                select: {
                    id: true,
                    username: true,
                    createdAt: true,
                    updatedAt: true,
                    is_online: true,
                    last_online: true,
                    images: true
                }
            });

            if (!otherUser) {
                throw new Error('User not found');
            }

            // Проверяем существование чата
            const chat = await this.prisma.chat.findFirst({
                where: {
                    id: chatId,
                    members: {
                        some: {
                            id: userId
                        }
                    }
                }
            });

            // Отправляем успешный результат
            const successMessage: ServerResponse<ChatDetailResponse> = {
                type: 'get_chat_detail_success',
                content: {
                    id: chatId,
                    user: otherUser
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(successMessage));
                }
            });

            return { id: chatId, user: otherUser };
        } catch (error) {
            console.error('Error getting chat detail:', error);

            // Отправляем сообщение об ошибке
            const errorMessage: StateResponse<'get_chat_detail'> = {
                type: 'get_chat_detail_error',
                content: {
                    requestId,
                    message: error.message || 'Failed to get chat detail'
                }
            };

            connections.forEach(({ ws }) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(errorMessage));
                }
            });

            throw error;
        }
    }

    private async updateUserOnlineStatus(userId: string): Promise<void> {
        try {
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    is_online: true,
                    last_online: new Date()
                }
            });

            // Получаем чаты пользователя
            const chats = await this.prisma.chat.findMany({
                where: {
                    members: {
                        some: { id: userId }
                    }
                },
                include: {
                    members: {
                        select: {
                            id: true
                        }
                    }
                }
            });

            // Оповещаем только участников чатов
            for (const chat of chats) {
                for (const member of chat.members) {
                    if (member.id !== userId) { // Не отправляем уведомление самому пользователю
                        const connections = this.getConnections(member.id);
                        const updatedUser = await this.getUserInfo(userId);
                        if (updatedUser) {
                            const statusUpdate: ServerResponse<{ user: UserInfo }> = {
                                type: 'user_status_updated',
                                content: { user: updatedUser }
                            };

                            connections.forEach(({ ws }) => {
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify(statusUpdate));
                                }
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error updating user online status:', error);
        }
    }

    private async updateUserOfflineStatus(userId: string): Promise<void> {
        try {
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    is_online: false,
                    last_online: new Date()
                }
            });

            // Получаем чаты пользователя
            const chats = await this.prisma.chat.findMany({
                where: {
                    members: {
                        some: { id: userId }
                    }
                },
                include: {
                    members: {
                        select: {
                            id: true
                        }
                    }
                }
            });

            // Оповещаем только участников чатов
            for (const chat of chats) {
                for (const member of chat.members) {
                    if (member.id !== userId) { // Не отправляем уведомление самому пользователю
                        const connections = this.getConnections(member.id);
                        const updatedUser = await this.getUserInfo(userId);
                        if (updatedUser) {
                            const statusUpdate: ServerResponse<{ user: UserInfo }> = {
                                type: 'user_status_updated',
                                content: { user: updatedUser }
                            };

                            connections.forEach(({ ws }) => {
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify(statusUpdate));
                                }
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error updating user offline status:', error);
        }
    }
}