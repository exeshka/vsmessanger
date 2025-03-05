export interface UserImage {
    id: number;
    url: string;
    hash: string;
    createdAt: Date;
    userId: string;
}

export interface UserInfo {
    id: string;
    username: string;
    avatar?: string;
    chats?: ChatWithMessages[];
    createdAt: Date;
    updatedAt: Date;
    images: UserImage[];
}

export interface Image {
    id: number;
    url: string;
    hash: string;
    createdAt: Date;
    userId: string;
}

export interface User extends UserInfo {
    chatIds: string[]; // ID чатов пользователя
}

export enum ChatType {
    DIRECT = 'DIRECT',
    GROUP = 'GROUP'
}

export interface ChatMember {
    id: string;
    username: string;
    images: UserImage[];
}

// Определяем типы сообщений
export enum MessageContentType {
    TEXT = 'TEXT',
    IMAGE = 'IMAGE'
}

export enum MessageStatus {
    SENT = 'SENT',
    READ = 'READ'
}

export interface ChatMessage {
    id: string;
    content: string;
    contentType: MessageContentType;
    createdAt: Date;
    updatedAt: Date;
    chatId: string;
    senderId: string;
    sender: {
        id: string;
        username: string;
    };
}

export interface Chat {
    id: string;
    type: ChatType;
    members: ChatMember[];
    lastMessage: ChatMessage | null;
}

// Базовые типы сообщений для отправки
export type SendMessageType = 'send_message' | 'get_chats' | 'get_users' | 'get_messages';

// Типы сообщений для получения
export type ReceiveMessageType = 'receive_message';

// Все возможные состояния для каждого типа сообщения
export type MessageState = 'loading' | 'success' | 'error';

// Служебные типы сообщений
export type ServiceMessageType = 'system' | 'error' | 'invalid_recipient_id' | 'chats_list' | 'users_list';

// Базовые типы для всех сообщений
export type BaseMessageType = 'send_message' | 'get_chats' | 'get_users' | 'get_messages' | 'update_messages_status';

export type MessageType =
    | BaseMessageType
    | `${BaseMessageType}_${MessageState}`
    | 'system'
    | 'error';

// Интерфейс для сообщения с изображением
export interface ImageMessageContent {
    url: string;
    caption?: string;
}

export interface MessageContent {
    text: string | ImageMessageContent;
    type: MessageContentType;
}

export interface ServerMessage {
    type: string;
    content: {
        text: string | ImageMessageContent;
        type: MessageContentType;
    };
}

export interface ServerResponse<T> {
    type: string;
    content: T;
}

export interface MessageData {
    chat_id: string;
    message_id: string;
    text: string | ImageMessageContent;
    type: MessageContentType;
    status: MessageStatus;
    from: UserInfo;
    timestamp: string;
}

export interface ChatData {
    id: string;
    type: ChatType;
    members: UserInfo[];
    lastMessage: {
        id: string;
        content: string;
        contentType: MessageContentType;
        createdAt: Date;
        sender: UserInfo;
    } | null;
    name: string;
}

export interface ChatListItem {
    id: string;
    type: ChatType;
    name?: string;
    members: UserInfo[];
    last_message: MessageData | null;
}

export interface ChatListContent {
    chats: ChatListItem[];
}

export interface UsersListContent {
    users: UserInfo[];
}

export interface ErrorContent {
    message: string;
}

export interface LoadingState {
    requestId: string;
}

export interface ErrorState extends LoadingState {
    message: string;
}

export type StateResponse<T extends BaseMessageType> =
    | { type: `${T}_loading`; content: LoadingState }
    | { type: `${T}_success`; content: any }
    | { type: `${T}_error`; content: ErrorState };

export interface SocketMessage {
    type: MessageType;
    content: ServerMessage;
}

export interface SystemMessageData {
    text: string;
    messageType: MessageContentType;
    from?: UserInfo;
}

export interface PrismaMessage {
    id: string;
    content: string;
    contentType: 'TEXT' | 'IMAGE';
    createdAt: Date;
    sender: {
        id: string;
        username: string;
        createdAt: Date;
        updatedAt: Date;
        images: UserImage[];
    };
}

export interface PrismaChat {
    id: string;
    type: 'DIRECT';
    members: {
        id: string;
        username: string;
        createdAt: Date;
        updatedAt: Date;
        images: UserImage[];
    }[];
    messages: PrismaMessage[];
}

export interface ChatWithMessages {
    id: string;
    type: ChatType;
    name?: string;
    members: UserInfo[];
    messages: {
        id: string;
        content: string;
        contentType: MessageContentType;
        sender: UserInfo;
        createdAt: Date;
    }[];
}

export interface ExtendedServerMessage extends ServerMessage {
    message_id?: string;
}

export interface GetMessagesContent {
    chat_id: string;
    page?: number;
    limit?: number;
}

export interface MessagesListContent {
    messages: MessageData[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
    };
}

export interface ExtendedMessageContent extends MessageContent {
    chat_id?: string;
    page?: number;
    limit?: number;
    message_ids?: string[];
}