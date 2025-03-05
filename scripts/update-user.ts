import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateUser() {
    try {
        const updatedUser = await prisma.user.update({
            where: {
                // Укажите username или id пользователя, которого хотите обновить
                username: 'your_username'
            },
            data: {
                // Создаем новые записи изображений
                images: {
                    create: [
                        {
                            url: 'url_to_your_image',
                            hash: 'image_hash_here'
                        }
                    ]
                },
                password: 'your_password_hash'  // хеш пароля
            }
        });

        console.log('User updated successfully:', updatedUser);
    } catch (error) {
        console.error('Error updating user:', error);
    } finally {
        await prisma.$disconnect();
    }
}

updateUser();