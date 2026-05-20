import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenBlacklistService } from './token-blacklist.service';
import { AuthenticationService } from './authentication.service';
import { UserManagementService } from './user-management.service';
import { PasswordResetService } from './password-reset.service';
import { MailModule } from '../../common/mail/mail.module';

@Module({
  imports: [
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  providers: [
    JwtStrategy,
    TokenBlacklistService,
    AuthenticationService,
    UserManagementService,
    PasswordResetService,
  ],
  controllers: [AuthController],
  exports: [AuthenticationService, UserManagementService, PasswordResetService, JwtModule, TokenBlacklistService],
})
export class AuthModule {}
