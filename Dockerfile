# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Копируем только файлы, необходимые для установки зависимостей
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Устанавливаем все зависимости (включая devDependencies)
RUN npm ci

# Копируем исходный код
COPY src/ ./src/
COPY prisma/ ./prisma/

# Генерируем Prisma Client
RUN npx prisma generate

# Собираем приложение
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Копируем только файлы, необходимые для production
COPY package*.json ./
RUN npm ci --only=production

# Копируем собранное приложение и Prisma схему
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Создаем директорию для загрузок
RUN mkdir -p uploads/images

EXPOSE 3000
EXPOSE 8080

CMD ["node", "dist/main.js"]
