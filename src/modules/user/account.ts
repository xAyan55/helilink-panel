import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { getUser } from '../../handlers/utils/user/user';
import logger from '../../handlers/logger';
import validator from 'validator';

interface ErrorMessage {
  message?: string;
}

const accountModule: Module = {
  info: {
    name: 'Account Module',
    description: 'Provides user profile account viewing and non-authentication settings.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author:        'HeliLink',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get(
      '/account',
      isAuthenticated(),
      async (req: Request, res: Response) => {
        const errorMessage: ErrorMessage = {};
        const userId = req.session?.user?.id;
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        try {
          const [user, loginHistory] = await Promise.all([
            prisma.users.findUnique({ where: { id: userId } }),
            prisma.loginHistory.findMany({
              where: { userId },
              orderBy: { timestamp: 'desc' },
              take: 10,
            }),
          ]);
          if (!user) {
            errorMessage.message = 'User not found.';
            res.render('user/account', { errorMessage, user, req });
            return;
          }

          res.render('user/account', {
            errorMessage,
            user,
            req,
            settings,
            loginHistory,
          });
        } catch (error) {
          logger.error('Error fetching user:', error);
          errorMessage.message = 'Error fetching user data.';
          res.render('user/account', {
            errorMessage,
            user: getUser(req),
            req,
            settings,
            loginHistory: [],
          });
        }
      },
    );

    router.post(
      '/update-description',
      isAuthenticated(),
      async (req: Request, res: Response) => {
        const { description } = req.body;
        if (!description) {
          res.status(400).send('Description parameter is required.');
          return;
        }

        const cleanDesc = validator.trim(String(description).slice(0, 255));
        if (cleanDesc.length === 0) {
          res.status(400).send('Description cannot be empty.');
          return;
        }

        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findFirst({
            where: { id: userId },
          });

          if (!user) {
            res.redirect('/login');
            return;
          }

          await prisma.users.update({
            where: { id: userId },
            data: { description: cleanDesc },
          });

          res.status(200).json({ message: 'Description updated successfully.' });
          return;
        } catch (error) {
          logger.error('Error updating description:', error);
          res.status(500).send('Internal Server Error');
        }
      },
    );

    router.post(
      '/set-language',
      isAuthenticated(),
      async (req: Request, res: Response) => {
        const { language } = req.body;

        if (!language) {
          res.status(400).send('Language parameter is required.');
          return;
        }

        const supportedLanguages = ['en', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'zh', 'ja', 'ta'];
        if (!supportedLanguages.includes(language)) {
          res.status(400).send('Unsupported language.');
          return;
        }

        try {
          res.cookie('lang', language, {
            maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
            httpOnly: true,
            sameSite: 'strict'
          });

          res.status(200).json({ message: 'Language preference saved.' });
        } catch (error) {
          logger.error('Error setting language preference:', error);
          res.status(500).send('Internal Server Error');
        }
      },
    );

    router.get(
      '/credits',
      isAuthenticated(),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const [user, settings] = await Promise.all([
            prisma.users.findUnique({ where: { id: userId } }),
            prisma.settings.findUnique({ where: { id: 1 } }),
          ]);
          if (!user) return res.redirect('/login');
          const pkg = JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'package.json'), 'utf-8'));
          res.render('user/credits', { user, req, settings, version: pkg.version });
        } catch (error) {
          logger.error('Error loading credits page:', error);
          res.redirect('/');
        }
      },
    );

    return router;
  },
};

export default accountModule;
