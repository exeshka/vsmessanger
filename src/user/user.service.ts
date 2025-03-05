import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as sharp from 'sharp';
import { encode } from 'blurhash';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UserService {
    private readonly uploadsPath: string;

    constructor(private prisma: PrismaService) {
        this.uploadsPath = path.join(process.cwd(), 'uploads');
    }

    async getUserById(userId: string) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                createdAt: true,
                updatedAt: true,
                images: {
                    select: {
                        url: true,
                        hash: true
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                }
            }
        });
    }

    async checkUsernameExists(username: string): Promise<boolean> {
        if (!username) {
            return false;
        }

        const user = await this.prisma.user.findFirst({
            where: {
                username: username
            }
        });
        return !!user;
    }

    private async encodeImageToBlurhash(imagePath: string): Promise<string> {
        const { data, info } = await sharp(imagePath)
            .raw()
            .ensureAlpha()
            .resize(32, 32, { fit: 'inside' })
            .toBuffer({ resolveWithObject: true });

        const hash = encode(
            new Uint8ClampedArray(data),
            info.width,
            info.height,
            4,
            4,
        );

        return hash;
    }

    async uploadImage(file: Express.Multer.File, userId: string, baseUrl: string) {
        // Проверяем тип файла
        if (!file.mimetype.startsWith('image/')) {
            throw new Error('Only image files are allowed');
        }

        // Генерируем уникальное имя файла
        const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
        const imagesDir = path.join(this.uploadsPath, 'images');
        const filePath = path.join(imagesDir, fileName);

        // Создаем директорию, если её нет
        await fs.promises.mkdir(imagesDir, { recursive: true });

        // Сохраняем файл
        await fs.promises.writeFile(filePath, file.buffer);

        // Генерируем blurhash
        const hash = await this.encodeImageToBlurhash(filePath);

        // Формируем полный URL для доступа к изображению
        const url = `${baseUrl}/uploads/images/${fileName}`;

        // Сохраняем информацию в базе данных
        const image = await this.prisma.image.create({
            data: {
                url,
                hash,
                userId,
            },
        });

        return image;
    }
}
