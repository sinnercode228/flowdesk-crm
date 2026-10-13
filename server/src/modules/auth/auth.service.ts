import { randomUUID } from 'node:crypto';
import type { PrismaClient, User as UserRow } from '@prisma/client';
import type { AuthSession, Role, User } from '@flowdesk/shared';
import type { Env } from '../../config/env';
import { toUserDto } from '../../lib/dto';
import { notFound, unauthorized } from '../../lib/errors';
import { getDummyHash, verifyPassword } from '../../lib/password';
import { generateRefreshToken, hashToken, signAccessToken } from '../../lib/tokens';

const DAY_MS = 86_400_000;
/** Families deleted per login at most, so the statement stays far below bind-parameter limits. */
const CLEANUP_BATCH = 500;

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
    await this.deleteExpiredFamilies(user.id, new Date());
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

    if (stored.revokedAt) return this.reuseDetected(stored.familyId, now);
    if (stored.expiresAt <= now) throw unauthorized('Refresh token expired', 'TOKEN_EXPIRED');

    const session = await this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent refreshes with the same token, only one wins.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count !== 1) return null;

      const issued = await this.issueSession(stored.user, stored.familyId, tx);
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { replacedById: issued.refreshTokenId },
      });
      return issued.dto;
    });
    // Losing the update means the token was revoked between our read and our write, which is
    // the same event as finding it revoked above, only closer in time. It gets the same answer:
    // the server cannot tell a client's double submit from a thief racing the client, and if
    // the thief won, leaving the family alive would leave the thief a working token. The
    // update only reports 0 rows after the winner's transaction has committed, so its new
    // refresh token exists by now and is revoked with the rest; both callers log in again.
    if (!session) return this.reuseDetected(stored.familyId, now);
    return session;
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

  /** Runs outside the rotation transaction, so the revocation is not rolled back. */
  private async reuseDetected(familyId: string, now: Date): Promise<never> {
    await this.revokeFamily(familyId, now);
    throw unauthorized('Refresh token reuse detected, please log in again', 'TOKEN_REUSED');
  }

  /**
   * Deletes the user's token families in which every token has expired, up to CLEANUP_BATCH
   * per login. Nothing in such a family can be exchanged any more, so there is no reuse left
   * to detect. Families with a valid token keep all their rows, revoked ones included, so a
   * replay of any of them is still recognised. The database finds the dead families itself,
   * so the query does not grow with the number of live sessions. The delete only touches
   * expired rows, so a token issued between the two queries is never removed, and they need
   * no transaction.
   */
  private async deleteExpiredFamilies(userId: string, now: Date) {
    const dead = await this.prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId },
      having: { expiresAt: { _max: { lte: now } } },
      orderBy: { familyId: 'asc' },
      take: CLEANUP_BATCH,
    });
    if (dead.length === 0) return;
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lte: now }, familyId: { in: dead.map((f) => f.familyId) } },
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
