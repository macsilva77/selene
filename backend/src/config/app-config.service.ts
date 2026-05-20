import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get frontendUrl(): string {
    return this.config.get<string>('frontendUrl')!;
  }

  get isProduction(): boolean {
    return this.config.get<string>('nodeEnv') === 'production';
  }

  get jwt() {
    return {
      secret:           this.config.get<string>('jwt.secret')!,
      expiresIn:        this.config.get<string>('jwt.expiresIn')!,
      refreshSecret:    this.config.get<string>('jwt.refreshSecret')!,
      refreshExpiresIn: this.config.get<string>('jwt.refreshExpiresIn')!,
    };
  }

  get redis() {
    return {
      host:     this.config.get<string>('redis.host')!,
      port:     this.config.get<number>('redis.port')!,
      password: this.config.get<string>('redis.password') || undefined,
    };
  }

  get smtp() {
    return {
      host: this.config.get<string>('smtp.host')!,
      port: this.config.get<number>('smtp.port')!,
      user: this.config.get<string>('smtp.user')!,
      pass: this.config.get<string>('smtp.pass')!,
      from: this.config.get<string>('smtp.from')!,
    };
  }

  get certEncryptionKey(): string {
    return this.config.get<string>('certEncryptionKey')!;
  }
}
