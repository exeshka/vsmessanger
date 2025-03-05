import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as chalk from 'chalk';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        const method = req.method;
        const url = req.url;
        const now = Date.now();
        const ip = req.ip;

        // Цветовое оформление для разных методов
        const methodColors = {
            GET: chalk.green,
            POST: chalk.yellow,
            PUT: chalk.blue,
            DELETE: chalk.red,
            PATCH: chalk.magenta,
        };

        const colorMethod = methodColors[method] ? methodColors[method](method) : method;

        return next.handle().pipe(
            tap((res) => {
                const response = context.switchToHttp().getResponse();
                const delay = Date.now() - now;
                const statusCode = response.statusCode;

                // Цвет статуса в зависимости от кода
                const statusColor = statusCode >= 500 ? chalk.red :
                    statusCode >= 400 ? chalk.yellow :
                        statusCode >= 300 ? chalk.cyan :
                            statusCode >= 200 ? chalk.green :
                                chalk.grey;

                console.log(
                    `${chalk.blue('→')} ${colorMethod} ${chalk.grey(url)} ${statusColor(statusCode)} ${chalk.grey(delay + 'ms')} ${chalk.grey('from ' + ip)}`
                );

                // Если произошла ошибка, логируем дополнительную информацию
                if (statusCode >= 400) {
                    console.log(chalk.red('Error:'), res.message || 'Unknown error');
                }
            })
        );
    }
}