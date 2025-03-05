import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('login')
    async login(@Body() authDto: AuthDto) {
        try {
            const user = await this.authService.validateUser(
                authDto.username,
                authDto.password,
            );
            return this.authService.login(user);
        } catch (error) {
            if (error.status === 401) {
                throw error;
            }
            throw new BadRequestException('Invalid request data');
        }
    }

    @Post('register')
    async register(@Body() authDto: AuthDto) {
        try {
            return await this.authService.register(
                authDto.username,
                authDto.password,
            );
        } catch (error) {
            if (error.status === 401) {
                throw error;
            }
            throw new BadRequestException('Invalid request data');
        }
    }
}
