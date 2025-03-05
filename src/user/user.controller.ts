import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException, UseGuards, Request, Get, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../auth/interfaces/jwt-user.interface';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) { }

    @Get('check')
    async checkUsername(@Query('nickname') nickname: string) {
        return {
            exists: await this.userService.checkUsernameExists(nickname)
        };
    }

    @Post('upload-image')
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(FileInterceptor('image'))
    async uploadImage(@UploadedFile() file: Express.Multer.File, @Request() req) {
        try {
            const userId = req.user.userId;
            const baseUrl = req.protocol + '://' + req.get('host') + '/api';
            return await this.userService.uploadImage(file, userId, baseUrl);
        } catch (error) {
            throw new BadRequestException(error.message);
        }
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    async getCurrentUser(@CurrentUser() user: JwtUser) {
        return this.userService.getUserById(user.userId);
    }
}
