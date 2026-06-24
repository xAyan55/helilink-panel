import prisma from '../../db';
import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import logger from '../../handlers/logger';
import axios from 'axios';
import { randomBytes } from 'crypto';

declare module 'express-session' {
  interface SessionData {
    user: {
      id: number;
      email: string;
      isAdmin: boolean;
      username: string;
      description: string;
    };
    oauthState?: string;
  }
}

const authServiceModule: Module = {
  info: {
    name:          'Auth System Module',
    description:   'Discord OAuth2 authentication and authorisation for users.',
    version:          '2.0.0',
    moduleVersion: '2.0.0',
    author:        'HeliLink',
    license:       'MIT',
  },

  router: () => {
    const router = Router();

    // ── GET /auth/discord ────────────────────────────────────────────────────
    router.get('/auth/discord', (req: Request, res: Response) => {
      try {
        const state = randomBytes(16).toString('hex');
        req.session.oauthState = state;

        const clientID = process.env.DISCORD_CLIENT_ID || '';
        const redirectURI = encodeURIComponent(process.env.DISCORD_REDIRECT_URI || '');
        const authorizeUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientID}&redirect_uri=${redirectURI}&response_type=code&scope=identify+email&state=${state}`;

        res.redirect(authorizeUrl);
      } catch (err) {
        logger.error('Error initiating Discord OAuth:', err);
        res.redirect('/login?err=oauth_init_failed');
      }
    });

    // ── GET /auth/discord/callback ───────────────────────────────────────────
    router.get('/auth/discord/callback', async (req: Request, res: Response) => {
      const { code, state } = req.query;
      const sessionState = req.session.oauthState;

      // Clear OAuth state from session immediately
      delete req.session.oauthState;

      if (!state || state !== sessionState) {
        return res.redirect('/login?err=invalid_state');
      }

      if (!code) {
        return res.redirect('/login?err=missing_code');
      }

      try {
        // 1. Exchange authorization code for token
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

        // 2. Fetch user information from Discord
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

        // 3. Find user by discord_id (sole identity source)
        let user = await prisma.users.findUnique({
          where: { discord_id: discordId },
        });

        // 4. Dynamic Admin Assignment: check if user ID is in split array
        const adminIds = (process.env.DISCORD_ADMIN_IDS || '')
          .split(',')
          .map(id => id.trim());
        const isAdmin = adminIds.includes(discordId);

        const discordAvatarUrl = avatar
          ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${Number(discordId) % 5}.png`;

        if (!user) {
          // If the user does not exist, automatically register them
          const userEmail = email || `${username}@discord.local`;

          user = await prisma.users.create({
            data: {
              email: userEmail,
              username: username,
              password: null, // password is left optional and null
              discord_id: discordId,
              discord_username: username,
              discord_display_name: global_name || username,
              discord_avatar: discordAvatarUrl,
              discord_email: email || null,
              avatar: discordAvatarUrl, // set in existing avatar field for global compat
              isAdmin: isAdmin,
              description: global_name || 'HeliLink User',
            },
          });
        } else {
          // User already exists, update Discord details and dynamic admin check
          user = await prisma.users.update({
            where: { id: user.id },
            data: {
              discord_username: username,
              discord_display_name: global_name || username,
              discord_avatar: discordAvatarUrl,
              discord_email: email || null,
              avatar: discordAvatarUrl, // sync avatar field
              isAdmin: isAdmin, // ensure admin privileges sync dynamically based on env vars
            },
          });
        }

        // 5. Session security: regenerate session to prevent session fixation
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

        // Create login history record
        await prisma.loginHistory.create({
          data: {
            userId:    user.id,
            ipAddress: req.ip || 'unknown',
            userAgent: req.headers['user-agent'] || null,
          },
        });

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
