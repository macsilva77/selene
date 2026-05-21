import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditAcao } from '@prisma/client';
import { AuthenticationService } from './authentication.service';
import { UserManagementService } from './user-management.service';
import { PasswordResetService } from './password-reset.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateTenantDto } from './dto/update-diretor.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/interceptors/audit.interceptor';
import { AppConfigService } from '../../config/app-config.service';
import { Request, Response, CookieOptions } from 'express';
import {
  COOKIE_NAMES,
  ACCESS_COOKIE_MAX_AGE_MS,
  REFRESH_COOKIE_MAX_AGE_MS,
} from '../../common/constants';

const ACCESS_COOKIE  = COOKIE_NAMES.ACCESS;
const REFRESH_COOKIE = COOKIE_NAMES.REFRESH;

function accessCookieOpts(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    // Em produção: SameSite=None (cross-origin entre selene-api e selene-web).
    // Em dev: SameSite=Lax (mesmo domínio localhost).
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  };
}

function refreshCookieOpts(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

@ApiTags('Auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;

  constructor(
    private readonly authService: AuthenticationService,
    private readonly userService: UserManagementService,
    private readonly passwordService: PasswordResetService,
    private readonly appConfig: AppConfigService,
  ) {
    this.isProd = this.appConfig.isProduction;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Autenticação de usuário' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isProd = this.isProd;
    const result = await this.authService.login(
      dto,
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? '',
    );
    res.cookie(ACCESS_COOKIE,  result.accessToken,  accessCookieOpts(isProd));
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts(isProd));
    const { refreshToken: _, ...safeResult } = result;
    return safeResult;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Encerrar sessão e revogar tokens' })
  async logout(
    @CurrentUser('sub') userId: string,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('jti') jti: string,
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isProd = this.isProd;
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    res.clearCookie(ACCESS_COOKIE,  { ...accessCookieOpts(isProd),  maxAge: undefined });
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOpts(isProd), maxAge: undefined });
    return this.authService.logout(userId, tenantId, jti, req.ip ?? 'unknown', refreshToken);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const isProd = this.isProd;
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    const result = await this.authService.refreshTokens(refreshToken);
    res.cookie(ACCESS_COOKIE,  result.accessToken,  accessCookieOpts(isProd));
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts(isProd));
    return { accessToken: result.accessToken };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dados do usuário autenticado (com permissões atualizadas do banco)' })
  me(@CurrentUser('sub') userId: string) {
    return this.userService.getMe(userId);
  }

  @Post('usuarios')
  @RequiresPermission('usuarios.create')
  @Audit(AuditAcao.CREATE, 'Usuario')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar usuário (ADMIN)' })
  criarUsuario(@Body() dto: CreateUserDto) {
    return this.userService.criarUsuario(dto);
  }

  @Get('usuarios')
  @RequiresPermission('usuarios.view')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar usuários ativos do tenant' })
  listarUsuarios() {
    return this.userService.listarUsuarios();
  }

  @Delete('usuarios/:id')
  @RequiresPermission('usuarios.delete')
  @Audit(AuditAcao.INATIVAR, 'Usuario')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inativar usuário (ADMIN)' })
  inativarUsuario(@Param('id') id: string) {
    return this.userService.inativarUsuario(id);
  }

  @Delete('usuarios/:id/remover')
  @RequiresPermission('usuarios.delete')
  @Audit(AuditAcao.INATIVAR, 'Usuario')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Excluir permanentemente usuário (ADMIN)' })
  excluirUsuario(@Param('id') id: string) {
    return this.userService.excluirUsuario(id);
  }

  @Patch('usuarios/:id')
  @RequiresPermission('usuarios.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar usuário (ADMIN)' })
  atualizarUsuario(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { ip: string; correlationId?: string },
  ) {
    return this.userService.atualizarUsuario(id, dto, {
      usuarioId,
      ipOrigem: req.ip,
      correlationId: req.correlationId,
    });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar link de redefinição de senha' })
  esqueceuSenha(@Body() dto: ForgotPasswordDto) {
    return this.passwordService.esqueceuSenha(dto.email, dto.tenantSlug);
  }

  @Public()
  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Definir senha via token de primeiro acesso' })
  definirSenha(@Body() dto: SetPasswordDto) {
    return this.passwordService.definirSenha(dto);
  }

  @Get('meu-tenant')
  @RequiresPermission('usuarios.view')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dados do tenant do usuário logado (incluindo Diretor Responsável)' })
  meuTenant() {
    return this.userService.meuTenant();
  }

  @Patch('meu-tenant')
  @RequiresPermission('usuarios.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar dados do tenant' })
  atualizarMeuTenant(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.userService.atualizarMeuTenant(dto, usuarioId);
  }
}
