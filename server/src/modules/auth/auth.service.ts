import { randomUUID } from 'node:crypto';
import type { PrismaClient, User as UserRow } from '@prisma/client';
import type { AuthSession, Role, User } from '@flowdesk/shared';
import type { Env } from '../../config/env';
import { toUserDto } from '../../lib/dto';
import { notFound, unauthorized } from '../../lib/errors';
import { getDummyHash, verifyPassword } from '../../lib/password';
import { generateRefreshToken, hashToken, signAccessToken } from '../../lib/tokens';

const DAY_MS = 86_400_000;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
  ) {}

  async login(email: string, password: string): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always run a password check so response timing does not reveal which e-mails exist.
    const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !valid) throw unauthorized('Invalid e-mail or password', 'INVALID_CREDENTIALS');
    return (await this.issueSession(user, randomUUID())).dto;
  }

  /**
   * Rotates a refresh token. Presenting an already rotated (revoked) token is treated as
   * theft: the whole token family is revoked and the user has to log in again.
   */
  async refresh(rawToken: string): Promise<AuthSession> {
    const now = new Date();
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!stored) throw unauthorized('Invalid refresh token');

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId, now);
      throw unauthorized('Refresh token reuse detected, please log in again', 'TOKEN_REUSED');
    }
    if (stored.expiresAt <= now) throw unauthorized('Refresh token expired', 'TOKEN_EXPIRED');

    return this.prisma.$transaction(async (tx) => {
      // Conditional update guards against two concurrent refreshes with the same token.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count !== 1)
        throw unauthorized('Refresh token reuse detected, please log in again', 'TOKEN_REUSED');

      const session = await this.issueSession(stored.user, stored.familyId, tx);
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { replacedById: session.refreshTokenId },
      });
      return session.dto;
    });
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (stored) await this.revokeFamily(stored.familyId, new Date());
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User');
    return toUserDto(user);
  }

  private revokeFamily(familyId: string, now: Date) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private async issueSession(
    user: UserRow,
    familyId: string,
    db: Pick<PrismaClient, 'refreshToken'> = this.prisma,
  ): Promise<{ dto: AuthSession; refreshTokenId: string }> {
    const refreshToken = generateRefreshToken();
    const record = await db.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        familyId,
        userId: user.id,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      },
    });
    const accessToken = await signAccessToken(
      { id: user.id, email: user.email, name: user.name, role: user.role as Role },
      this.env.JWT_ACCESS_SECRET,
      this.env.JWT_ACCESS_TTL,
    );
    const dto: AuthSession = {
      tokenType: 'Bearer',
      accessToken,
      expiresIn: this.env.JWT_ACCESS_TTL,
      refreshToken,
      user: toUserDto(user),
    };
    return { dto, refreshTokenId: record.id };
  }
}
