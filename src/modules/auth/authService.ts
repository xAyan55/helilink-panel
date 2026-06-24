import prisma from '../../db';
import { Router, Request, Response, NextFunction } from 'express';
import { Module } from '../../handlers/moduleInit';
import logger from '../../handlers/logger';
import axios from 'axios';
import { randomBytes, createHmac } from 'crypto';

declare module 'express-session' {
  interface SessionData {
    user: {
      id: number;
      email: string;
      isAdmin: boolean;
      username: string;
      description: string;
    };
    discordOAuthState?: string;
  }
}

// ---------------------------------------------------------------------------
// Helpers — HMAC-signed compound state
// ---------------------------------------------------------------------------
// The OAuth state sent to Discord is:  randomHex.sessionId.hmacSignature
// On callback we can extract the session ID even if the browser dropped
// all cookies (common behind Cloudflare Tunnel cross-site redirects).
// The HMAC prevents tampering so an attacker cannot forge a session ID.
// ---------------------------------------------------------------------------

function getHmacSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required');
  return secret;
}

function buildSignedState(randomState: string, sessionId: string): string {
  const payload = `${randomState}.${sessionId}`;
  const sig = createHmac('sha256', getHmacSecret())
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

function parseSignedState(
  compound: string,
): { randomState: string; sessionId: string } | null {
  const parts = compound.split('.');
  if (parts.length !== 3) return null;
  const [randomState, sessionId, sig] = parts;
  const expected = createHmac('sha256', getHmacSecret())
    .update(`${randomState}.${sessionId}`)
    .digest('hex');
  // Constant-time comparison
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return null;
  return { randomState, sessionId };
}

const authServiceModule: Module = {
  info: {
    name:          'Auth System Module',
    description:   'Discord OAuth2 authentication and authorisation for users.',
    version:          '2.0.0',
    moduleVersion: '2.0.0',
    author:        'HeliLink',
    license:       'ENV',
  },

  router: () => {
    const router = Router();

    // ── GET /auth/discord ────────────────────────────────────────────────────
    router.get('/auth/discord', (req: Request, res: Response, next: NextFunction) => {
      try {
        const randomState = randomBytes(16).toString('hex');
        req.session.discordOAuthState = randomState;

        logger.info(`[OAuth] Redirect: state=${randomState}, sid=${req.sessionID}`);

        const clientID = process.env.DISCORD_CLIENT_ID || '';
        const redirectURI = encodeURIComponent(process.env.DISCORD_REDIRECT_URI || '');

        // Save session first, then build signed state with the confirmed session ID
        req.session.save((err) => {
          if (err) {
            logger.error('[OAuth] Session save failed before redirect:', err);
            return next(err);
          }

          // Build compound state: randomHex.sessionId.hmac
          const compoundState = buildSignedState(randomState, req.sessionID);
          const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientID}&redirect_uri=${redirectURI}&response_type=code&scope=identify+email&state=${compoundState}`;

          logger.info(`[OAuth] Session saved. Redirecting to Discord...`);
          res.redirect(authorizeUrl);
        });
      } catch (err) {
        logger.error('Error initiating Discord OAuth:', err);
        return next(err);
      }
    });

    // ── GET /auth/discord/callback ───────────────────────────────────────────
    router.get('/auth/discord/callback', async (req: Request, res: Response) => {
      const { code, state: compoundState } = req.query;

      if (!compoundState || typeof compoundState !== 'string') {
        logger.warn('[OAuth] Callback missing state parameter');
        return res.redirect('/login?err=invalid_state');
      }

      // 1. Verify HMAC signature and extract session ID + random state
      const parsed = parseSignedState(compoundState);
      if (!parsed) {
        logger.warn('[OAuth] Callback state failed HMAC verification');
        return res.redirect('/login?err=invalid_state');
      }

      const { randomState, sessionId } = parsed;
      const hasCookies = !!(req.headers.cookie && req.headers.cookie.includes('connect.sid'));

      logger.info(`[OAuth] Callback: hasCookies=${hasCookies}, currentSid=${req.sessionID}, originalSid=${sessionId}`);

      // 2. Resolve the stored state — either from current session or from DB
      let storedState: string | undefined;

      if (hasCookies && req.sessionID === sessionId) {
        // Fast path: cookies survived, same session
        storedState = req.session.discordOAuthState;
      } else {
        // Fallback: cookies were lost (common behind Cloudflare Tunnel).
        // Load the original session directly from the database.
        logger.info(`[OAuth] Cookies lost — loading session ${sessionId} from DB`);
        try {
          const row = await prisma.session.findUnique({
            where: { session_id: sessionId },
          });
          if (row) {
            const sessionData = JSON.parse(row.data);
            storedState = sessionData.discordOAuthState;
          }
        } catch (dbErr) {
          logger.error('[OAuth] Failed to load session from DB:', dbErr);
        }
      }

      // 3. Validate state
      if (!storedState || storedState !== randomState) {
        logger.warn(`[OAuth] State mismatch: received=${randomState}, stored=${storedState}`);
        return res.redirect('/login?err=invalid_state');
      }

      // 4. Clean up: remove the used state from the original session in DB
      try {
        const row = await prisma.session.findUnique({
          where: { session_id: sessionId },
        });
        if (row) {
          const sessionData = JSON.parse(row.data);
          delete sessionData.discordOAuthState;
          await prisma.session.update({
            where: { session_id: sessionId },
            data: { data: JSON.stringify(sessionData) },
          });
        }
      } catch {
        // best effort cleanup
      }

      if (!code) {
        return res.redirect('/login?err=missing_code');
      }

      try {
        // 5. Exchange authorization code for token
        const tokenResponse = await axios.post(
          'https://discord.com/api/oauth2/token',
          new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID || '',
            client_secret: process.env.DISCORD_CLIENT_SECRET || '',
            grant_type: 'authorization_code',
            code: String(code),
            redirect_uri: process.env.DISCORD_REDIRECT_URI || '',
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );

        const { access_token } = tokenResponse.data;

        // 6. Fetch user information from Discord
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        });

        const discordUser = userResponse.data;
        const { id: discordId, username, email, avatar, global_name } = discordUser;

        if (!discordId) {
          return res.redirect('/login?err=invalid_discord_user');
        }

        // 7. Find user by discord_id (sole identity source)
        let user = await prisma.users.findUnique({
          where: { discord_id: discordId },
        });

        // 8. Dynamic Admin Assignment: check if user ID is in split array
        const adminIds = (process.env.DISCORD_ADMIN_IDS || '')
          .split(',')
          .map(id => id.trim());
        const isAdmin = adminIds.includes(discordId);

        const discordAvatarUrl = avatar
          ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${Number(discordId) % 5}.png`;

        if (!user) {
          const userEmail = email || `${username}@discord.local`;

          user = await prisma.users.create({
            data: {
              email: userEmail,
              username: username,
              password: null,
              discord_id: discordId,
              discord_username: username,
              discord_display_name: global_name || username,
              discord_avatar: discordAvatarUrl,
              discord_email: email || null,
              avatar: discordAvatarUrl,
              isAdmin: isAdmin,
              description: global_name || 'HeliLink User',
            },
          });
        } else {
          user = await prisma.users.update({
            where: { id: user.id },
            data: {
              discord_username: username,
              discord_display_name: global_name || username,
              discord_avatar: discordAvatarUrl,
              discord_email: email || null,
              avatar: discordAvatarUrl,
              isAdmin: isAdmin,
            },
          });
        }

        // 9. Session security: regenerate session to prevent session fixation
        await new Promise<void>((resolve, reject) =>
          req.session.regenerate(err => (err ? reject(err) : resolve()))
        );

        req.session.user = {
          id:          user.id,
          email:       user.email || '',
          isAdmin:     user.isAdmin,
          description: user.description ?? '',
          username:    user.username    ?? '',
        };

        // Save the new session before redirecting
        await new Promise<void>((resolve, reject) =>
          req.session.save(err => (err ? reject(err) : resolve()))
        );

        // Create login history record
        await prisma.loginHistory.create({
          data: {
            userId:    user.id,
            ipAddress: req.ip || 'unknown',
            userAgent: req.headers['user-agent'] || null,
          },
        });

        logger.info(`[OAuth] Login successful: user=${user.username}, id=${user.id}`);
        res.redirect('/');
      } catch (error) {
        logger.error('Discord login callback error:', error);
        res.redirect('/login?err=oauth_failed');
      }
    });

    // ── GET /logout ──────────────────────────────────────────────────────────
    router.get('/logout', (req: Request, res: Response) => {
      res.clearCookie('connect.sid');
      if (req.session) {
        req.session.destroy(() => res.redirect('/login'));
      } else {
        res.redirect('/login');
      }
    });

    return router;
  },
};

export default authServiceModule;
